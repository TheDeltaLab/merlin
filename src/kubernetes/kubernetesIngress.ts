import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml } from './kubernetesNamespace.js';

export const KUBERNETES_INGRESS_TYPE = 'KubernetesIngress';

export interface IngressRule {
    /** Hostname for this rule (e.g. api.example.com) */
    host: string;
    /** HTTP path rules */
    paths: IngressPath[];
}

export interface IngressPath {
    /** URL path (e.g. /, /api) */
    path: string;
    /** Path match type */
    pathType?: 'Prefix' | 'Exact' | 'ImplementationSpecific';
    /** Backend service name */
    serviceName: string;
    /** Backend service port */
    servicePort: number;
}

export interface KubernetesIngressConfig extends ResourceSchema {
    /** Kubernetes namespace */
    namespace: string;
    /** Ingress class name (e.g. nginx) */
    ingressClassName?: string;
    /** Ingress rules */
    rules: IngressRule[];
    /** TLS configuration — list of hosts + cert-manager secret name */
    tls?: Array<{
        hosts: string[];
        secretName: string;
    }>;
    /** cert-manager cluster issuer name (adds cert-manager.io/cluster-issuer annotation) */
    clusterIssuer?: string;
    /** Additional annotations */
    annotations?: Record<string, string>;
    /** Additional labels */
    labels?: Record<string, string>;

    /**
     * DNS zone binding — automatically create A records in Azure DNS
     * after the Ingress is applied.
     *
     * Hostnames are extracted from rules[].host. For each host that ends with
     * the configured dnsZone, an A record is created pointing to the Ingress
     * controller's LoadBalancer IP.
     *
     * Example: host "web.staging.thebrainly.dev" with dnsZone "thebrainly.dev"
     *   → creates A record "web.staging" in zone "thebrainly.dev"
     */
    bindDnsZone?: {
        /** DNS zone name, e.g. "thebrainly.dev" */
        dnsZone: string;
        /** Ingress controller service name (default: "ingress-nginx-controller") */
        ingressServiceName?: string;
        /** Ingress controller namespace (default: "ingress-nginx") */
        ingressNamespace?: string;
    };
}

export interface KubernetesIngressResource extends Resource<KubernetesIngressConfig> {}

/**
 * Cloud-agnostic KubernetesIngress render.
 *
 * Generates a kubectl apply command with an Ingress manifest.
 * Ingress name is: <resource.name>
 *
 * cert-manager integration:
 *   Set clusterIssuer: 'letsencrypt-prod' and provide tls[] entries.
 *   This adds the annotation cert-manager.io/cluster-issuer automatically.
 *
 * NGINX Ingress:
 *   Set ingressClassName: 'nginx'
 *
 * Example YAML usage:
 *   type: KubernetesIngress
 *   defaultConfig:
 *     namespace: trinity
 *     ingressClassName: nginx
 *     clusterIssuer: letsencrypt-prod
 *     rules:
 *       - host: api.trinity.example.com
 *         paths:
 *           - path: /
 *             pathType: Prefix
 *             serviceName: trinity-gateway
 *             servicePort: 3000
 *     tls:
 *       - hosts: [api.trinity.example.com]
 *         secretName: trinity-gateway-tls
 */
export class KubernetesIngressRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8sing';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        return [...captureCommands, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesIngressRender.isKubernetesIngressResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesIngress resource`);
        }

        const config = resource.config as KubernetesIngressConfig;
        const ingressName = resource.name;

        // Build annotations
        const annotations: Record<string, string> = { ...(config.annotations ?? {}) };
        if (config.clusterIssuer) {
            annotations['cert-manager.io/cluster-issuer'] = config.clusterIssuer;
        }

        // Build spec
        const spec: Record<string, unknown> = {};

        if (config.ingressClassName) {
            spec.ingressClassName = config.ingressClassName;
        }

        if (config.tls && config.tls.length > 0) {
            spec.tls = config.tls.map(t => ({
                hosts: t.hosts,
                secretName: t.secretName,
            }));
        }

        spec.rules = config.rules.map(rule => ({
            host: rule.host,
            http: {
                paths: rule.paths.map(p => ({
                    path: p.path,
                    pathType: p.pathType ?? 'Prefix',
                    backend: {
                        service: {
                            name: p.serviceName,
                            port: { number: p.servicePort },
                        },
                    },
                })),
            },
        }));

        const manifest = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
                name: ingressName,
                namespace: config.namespace,
                ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
                ...(config.labels ? { labels: config.labels } : {}),
            },
            spec,
        };

        const fileContent = manifestToYaml(manifest);

        const commands: Command[] = [{
            command: 'kubectl',
            args: ['apply', '-f', '__MERLIN_YAML_FILE__'],
            fileContent,
        }];

        // Append DNS record commands if bindDnsZone is configured
        commands.push(...this.renderBindDnsZone(config, resource.name));

        return commands;
    }

    /**
     * Generates Azure DNS A-record commands for each host in the Ingress rules.
     *
     * Steps:
     *   1. Capture the Ingress controller LoadBalancer external IP via kubectl
     *   2. Look up the DNS Zone resource group via az CLI
     *   3. For each host, create/update an A record pointing to the LB IP
     *
     * Returns an empty array if bindDnsZone is not configured.
     */
    private renderBindDnsZone(config: KubernetesIngressConfig, resourceName: string): Command[] {
        const { bindDnsZone } = config;
        if (!bindDnsZone) return [];

        const { dnsZone, ingressServiceName, ingressNamespace } = bindDnsZone;
        const svcName = ingressServiceName ?? 'ingress-nginx-controller';
        const svcNamespace = ingressNamespace ?? 'ingress-nginx';

        // Slug for env var names: uppercase, non-alphanumeric → underscore
        const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const varPrefix = `MERLIN_${slug(resourceName)}_${slug(dnsZone)}`;
        const lbIpVar = `${varPrefix}_LB_IP`;
        const dnsZoneRgVar = `${varPrefix}_DNS_ZONE_RG`;

        const commands: Command[] = [];

        // ── Step 1: Capture the Ingress LB external IP ──────────────────────
        commands.push({
            command: 'kubectl',
            args: [
                'get', 'svc', svcName,
                '-n', svcNamespace,
                '-o', `jsonpath={.status.loadBalancer.ingress[0].ip}`,
            ],
            envCapture: lbIpVar,
        });

        // ── Step 2: Look up the DNS Zone resource group ─────────────────────
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'zone', 'list',
                '--query', `[?name=='${dnsZone}'].resourceGroup`,
                '--output', 'tsv',
            ],
            envCapture: dnsZoneRgVar,
        });

        // ── Step 3: Create/update A records for each host ───────────────────
        // Extract unique hosts from rules
        const hosts = [...new Set(config.rules.map(r => r.host))];
        const zoneSuffix = `.${dnsZone}`;

        for (const host of hosts) {
            if (!host.endsWith(zoneSuffix)) {
                throw new Error(
                    `Ingress host "${host}" does not end with DNS zone "${dnsZone}". ` +
                    `bindDnsZone.dnsZone must be a suffix of every rule host.`
                );
            }
            // "web.staging.thebrainly.dev" → record name "web.staging"
            const recordName = host.slice(0, -zoneSuffix.length);

            // Use bash to attempt add-record first, fall back to update if the
            // record-set already exists. This makes the command idempotent.
            commands.push({
                command: 'bash',
                args: [
                    '-c',
                    `az network dns record-set a create --resource-group $${dnsZoneRgVar} --zone-name ${dnsZone} --name ${recordName} --ttl 300 2>/dev/null || true; ` +
                    `az network dns record-set a remove-record --resource-group $${dnsZoneRgVar} --zone-name ${dnsZone} --record-set-name ${recordName} --ipv4-address 0.0.0.0 2>/dev/null || true; ` +
                    `az network dns record-set a add-record --resource-group $${dnsZoneRgVar} --zone-name ${dnsZone} --record-set-name ${recordName} --ipv4-address $${lbIpVar}`,
                ],
            });
        }

        return commands;
    }

    private static isKubernetesIngressResource(resource: Resource): resource is KubernetesIngressResource {
        return resource.type === KUBERNETES_INGRESS_TYPE;
    }
}
