import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml, ensureNamespaceCommand } from './kubernetesNamespace.js';
import { MERLIN_YAML_FILE_PLACEHOLDER } from '../common/constants.js';

export const KUBERNETES_NETWORK_POLICY_TYPE = 'KubernetesNetworkPolicy';

// ── Public DSL types ─────────────────────────────────────────────────────────

/**
 * Match expression on a label key — mirrors K8s `matchExpressions[]` items.
 * Use this when you need In/NotIn semantics; for simple equality use `matchLabels`.
 */
export interface PodLabelMatchExpression {
    key: string;
    operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
    values?: string[];
}

export interface PodSelectorSpec {
    /** Equality match (becomes K8s `matchLabels`). */
    matchLabels?: Record<string, string>;
    /** In/NotIn/Exists match (becomes K8s `matchExpressions`). */
    matchExpressions?: PodLabelMatchExpression[];
}

/**
 * One peer in an `ingress.from[]` or `egress.to[]` list. Exactly one of
 *   - sameNamespace
 *   - namespace
 *   - ipBlock
 * is typically set. `podSelector` may be combined with `namespace` /
 * `sameNamespace` to narrow to specific pods within that namespace.
 */
export interface NetworkPolicyPeer {
    /** Restrict to pods in the SAME namespace as this NetworkPolicy. */
    sameNamespace?: boolean;
    /**
     * Restrict to pods in a specific other namespace, matched by
     * `kubernetes.io/metadata.name` (auto-injected by K8s 1.21+ on every ns).
     */
    namespace?: string;
    /** Optional pod selector applied within the chosen namespace. */
    podSelector?: PodSelectorSpec;
    /** CIDR-based peer (typically used for egress to public internet). */
    ipBlock?: {
        cidr: string;
        except?: string[];
    };
}

export interface NetworkPolicyPort {
    /** Port number or named port. Required. */
    port: number | string;
    /** Defaults to TCP (matching K8s default). */
    protocol?: 'TCP' | 'UDP' | 'SCTP';
}

export interface NetworkPolicyRule {
    /**
     * Logical name used to derive the K8s NetworkPolicy resource name.
     * Final name: `<resource.name>-<rule.name>`.
     */
    name: string;
    /**
     * Pods this rule targets. If omitted, the rule applies to ALL pods in
     * the namespace (i.e. `podSelector: {}`).
     */
    podSelector?: PodSelectorSpec;
    /** Allowed source peers (for ingress) or destination peers (for egress). */
    from?: NetworkPolicyPeer[];
    to?: NetworkPolicyPeer[];
    /**
     * Optional port restriction. If omitted, ALL ports of the matched
     * peers are allowed.
     */
    ports?: NetworkPolicyPort[];
}

export interface KubernetesNetworkPolicyConfig extends ResourceSchema {
    /** Target namespace. Required. */
    namespace: string;

    /**
     * If true (default), emit a "<name>-default-deny" NetworkPolicy that
     * denies ALL ingress and egress in the namespace. Allow rules below
     * then selectively re-open paths.
     */
    defaultDeny?: boolean;

    /**
     * If true (default), emit an egress allow-rule for kube-system DNS
     * (UDP/TCP port 53). Without this, default-deny breaks every pod.
     */
    allowDns?: boolean;

    /**
     * If true (default true), emit an egress + ingress allow-rule for
     * pod-to-pod traffic within the same namespace. Most apps depend on
     * this (e.g. oauth2-proxy → main app).
     */
    allowIntraNamespace?: boolean;

    /**
     * If true, emit an egress allow-rule for `0.0.0.0/0` minus the three
     * RFC1918 ranges. Lets pods talk to public SaaS endpoints (Azure
     * Blob/KV/AAD, OpenAI, OTLP collectors with public IPs, etc.) without
     * accidentally allowing traffic to other in-cluster namespaces.
     * Defaults to false; set true if you don't want to enumerate every
     * external destination.
     */
    allowExternalEgress?: boolean;

    /** Per-rule ingress allow list. */
    ingress?: NetworkPolicyRule[];

    /** Per-rule egress allow list. */
    egress?: NetworkPolicyRule[];

    /** Optional extra labels added to every emitted NetworkPolicy. */
    labels?: Record<string, string>;
}

export interface KubernetesNetworkPolicyResource extends Resource<KubernetesNetworkPolicyConfig> {}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Cloud-agnostic KubernetesNetworkPolicy render.
 *
 * Compiles a high-level allow-list DSL into one or more native K8s
 * `networking.k8s.io/v1` NetworkPolicy manifests, then applies them with
 * `kubectl apply`. The DSL collapses the boilerplate of the
 * default-deny + selective-allow pattern that every production namespace
 * needs once a NetworkPolicy engine (azure-npm / calico / cilium) is on.
 *
 * IMPORTANT: NetworkPolicy is enforced only when the AKS cluster (or
 * equivalent) was created with `--network-policy <azure|calico|cilium>`.
 * Without an engine, K8s accepts these manifests but silently ignores
 * them at the data plane. See `KubernetesClusterConfig.networkPolicy`.
 */
export class KubernetesNetworkPolicyRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8snp';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        const ns = (resolved.config as Record<string, unknown>)?.namespace as string | undefined;
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesNetworkPolicyRender.isKubernetesNetworkPolicyResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesNetworkPolicy resource`);
        }

        const config = resource.config as KubernetesNetworkPolicyConfig;
        if (!config.namespace) {
            throw new Error(`KubernetesNetworkPolicy ${resource.name}: 'namespace' is required`);
        }

        const baseName = resource.name;
        const ns = config.namespace;
        const baseLabels = config.labels;

        // Apply defaults — `defaultDeny`, `allowDns`, `allowIntraNamespace` all
        // default to true because the only sensible reason to use this type is
        // to flip the namespace from open-by-default to deny-by-default.
        const defaultDeny = config.defaultDeny ?? true;
        const allowDns = config.allowDns ?? true;
        const allowIntraNs = config.allowIntraNamespace ?? true;
        const allowExtEgress = config.allowExternalEgress ?? false;

        const manifests: Record<string, unknown>[] = [];

        if (defaultDeny) {
            manifests.push(buildPolicy({
                name: `${baseName}-default-deny`,
                namespace: ns,
                labels: baseLabels,
                podSelector: {},
                policyTypes: ['Ingress', 'Egress'],
            }));
        }

        if (allowDns) {
            manifests.push(buildPolicy({
                name: `${baseName}-allow-dns`,
                namespace: ns,
                labels: baseLabels,
                podSelector: {},
                policyTypes: ['Egress'],
                egress: [{
                    to: [{ namespaceSelector: nsLabelSelector('kube-system') }],
                    ports: [
                        { protocol: 'UDP', port: 53 },
                        { protocol: 'TCP', port: 53 },
                    ],
                }],
            }));
        }

        if (allowIntraNs) {
            manifests.push(buildPolicy({
                name: `${baseName}-allow-intra-namespace`,
                namespace: ns,
                labels: baseLabels,
                podSelector: {},
                policyTypes: ['Ingress', 'Egress'],
                ingress: [{ from: [{ podSelector: {} }] }],
                egress: [{ to: [{ podSelector: {} }] }],
            }));
        }

        if (allowExtEgress) {
            manifests.push(buildPolicy({
                name: `${baseName}-allow-external-egress`,
                namespace: ns,
                labels: baseLabels,
                podSelector: {},
                policyTypes: ['Egress'],
                egress: [{
                    to: [{
                        ipBlock: {
                            cidr: '0.0.0.0/0',
                            except: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
                        },
                    }],
                }],
            }));
        }

        for (const rule of config.ingress ?? []) {
            manifests.push(buildPolicy({
                name: `${baseName}-${rule.name}`,
                namespace: ns,
                labels: baseLabels,
                podSelector: rule.podSelector ?? {},
                policyTypes: ['Ingress'],
                ingress: [{
                    from: (rule.from ?? []).map(p => peerToK8s(p, ns)),
                    ports: rule.ports?.map(portToK8s),
                }],
            }));
        }

        for (const rule of config.egress ?? []) {
            manifests.push(buildPolicy({
                name: `${baseName}-${rule.name}`,
                namespace: ns,
                labels: baseLabels,
                podSelector: rule.podSelector ?? {},
                policyTypes: ['Egress'],
                egress: [{
                    to: (rule.to ?? []).map(p => peerToK8s(p, ns)),
                    ports: rule.ports?.map(portToK8s),
                }],
            }));
        }

        // Stitch all manifests into a single multi-document YAML stream so
        // `kubectl apply -f` handles them atomically (matching the alluneed
        // pilot's behavior).
        const fileContent = manifests.map(m => manifestToYaml(m)).join('\n---\n');

        return [{
            command: 'kubectl',
            args: ['apply', '-f', MERLIN_YAML_FILE_PLACEHOLDER],
            fileContent,
        }];
    }

    private static isKubernetesNetworkPolicyResource(resource: Resource): resource is KubernetesNetworkPolicyResource {
        return resource.type === KUBERNETES_NETWORK_POLICY_TYPE;
    }
}

// ── Helpers (internal) ──────────────────────────────────────────────────────

interface RawPolicySpec {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    podSelector: Record<string, unknown>;
    policyTypes: ('Ingress' | 'Egress')[];
    ingress?: Record<string, unknown>[];
    egress?: Record<string, unknown>[];
}

function buildPolicy(spec: RawPolicySpec): Record<string, unknown> {
    const out: Record<string, unknown> = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
            name: spec.name,
            namespace: spec.namespace,
            ...(spec.labels ? { labels: spec.labels } : {}),
        },
        spec: {
            podSelector: spec.podSelector,
            policyTypes: spec.policyTypes,
            ...(spec.ingress ? { ingress: spec.ingress } : {}),
            ...(spec.egress ? { egress: spec.egress } : {}),
        },
    };
    return out;
}

function nsLabelSelector(ns: string): Record<string, unknown> {
    return { matchLabels: { 'kubernetes.io/metadata.name': ns } };
}

function podSelectorToK8s(p: PodSelectorSpec | undefined): Record<string, unknown> {
    if (!p) return {};
    const out: Record<string, unknown> = {};
    if (p.matchLabels) out.matchLabels = p.matchLabels;
    if (p.matchExpressions) out.matchExpressions = p.matchExpressions;
    return out;
}

function peerToK8s(p: NetworkPolicyPeer, currentNs: string): Record<string, unknown> {
    // ipBlock is mutually exclusive with namespace/pod selectors.
    if (p.ipBlock) {
        return { ipBlock: p.ipBlock };
    }

    const out: Record<string, unknown> = {};

    // `sameNamespace` implies the current namespace; if user also passed
    // `namespace`, prefer the explicit one.
    const targetNs = p.namespace ?? (p.sameNamespace ? currentNs : undefined);
    if (targetNs !== undefined) {
        out.namespaceSelector = nsLabelSelector(targetNs);
    }
    if (p.podSelector) {
        out.podSelector = podSelectorToK8s(p.podSelector);
    }
    return out;
}

function portToK8s(p: NetworkPolicyPort): Record<string, unknown> {
    return {
        protocol: p.protocol ?? 'TCP',
        port: p.port,
    };
}
