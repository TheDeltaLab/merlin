import { describe, it, expect } from 'vitest';
import {
    KubernetesNetworkPolicyRender,
    KUBERNETES_NETWORK_POLICY_TYPE,
    KubernetesNetworkPolicyConfig,
} from '../kubernetesNetworkPolicy.js';
import { Resource } from '../../common/resource.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const render = new KubernetesNetworkPolicyRender();

function makeResource(config: Partial<KubernetesNetworkPolicyConfig> = {}): Resource {
    return {
        name: 'alluneed-netpol',
        type: KUBERNETES_NETWORK_POLICY_TYPE,
        ring: 'test',
        region: 'koreacentral',
        dependencies: [],
        exports: {},
        config: {
            namespace: 'alluneed',
            ...config,
        } as KubernetesNetworkPolicyConfig,
    };
}

/**
 * Returns the multi-document YAML body emitted by the render.
 * The first command is `bash` (ensure-namespace), the second is `kubectl apply`.
 */
async function renderYaml(config: Partial<KubernetesNetworkPolicyConfig> = {}): Promise<string> {
    const cmds = await render.render(makeResource(config));
    const apply = cmds.find(c => c.command === 'kubectl');
    expect(apply).toBeDefined();
    return apply!.fileContent ?? '';
}

function countDocuments(yaml: string): number {
    // Each NetworkPolicy doc is separated by `\n---\n`. A single doc has 0
    // separators, two docs have 1, etc.
    return (yaml.match(/\n---\n/g)?.length ?? 0) + 1;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('KubernetesNetworkPolicyRender', () => {
    it('getShortResourceTypeName returns k8snp', () => {
        expect(render.getShortResourceTypeName()).toBe('k8snp');
    });

    it('emits namespace ensure + kubectl apply commands', async () => {
        const cmds = await render.render(makeResource());
        expect(cmds[0].command).toBe('bash');
        expect(cmds[0].args.join(' ')).toContain('create namespace alluneed');
        const apply = cmds.find(c => c.command === 'kubectl')!;
        expect(apply.args).toContain('apply');
    });

    it('throws when namespace is missing', async () => {
        const resource = makeResource();
        // strip the namespace
        delete (resource.config as Record<string, unknown>).namespace;
        await expect(render.render(resource)).rejects.toThrow(/namespace.*required/i);
    });

    // ── Defaults ────────────────────────────────────────────────────────────

    it('emits default-deny + DNS + intra-ns by default (3 manifests)', async () => {
        const yaml = await renderYaml();
        expect(countDocuments(yaml)).toBe(3);
        expect(yaml).toContain('alluneed-netpol-default-deny');
        expect(yaml).toContain('alluneed-netpol-allow-dns');
        expect(yaml).toContain('alluneed-netpol-allow-intra-namespace');
    });

    it('default-deny manifest has empty podSelector and both policy types', async () => {
        const yaml = await renderYaml();
        // The default-deny doc must contain a podSelector that allows nothing
        // (i.e. the empty selector that matches all pods, combined with no
        // ingress/egress rules and both Ingress + Egress in policyTypes).
        expect(yaml).toMatch(/name: alluneed-netpol-default-deny[\s\S]*?podSelector: \{\}[\s\S]*?policyTypes:[\s\S]*?- Ingress[\s\S]*?- Egress/);
    });

    it('allow-dns manifest opens UDP/TCP 53 to kube-system', async () => {
        const yaml = await renderYaml();
        const dnsBlock = yaml.match(/name: alluneed-netpol-allow-dns[\s\S]*?(?=\n---|\n*$)/)?.[0] ?? '';
        expect(dnsBlock).toContain('kubernetes.io/metadata.name: kube-system');
        expect(dnsBlock).toContain('protocol: UDP');
        expect(dnsBlock).toContain('protocol: TCP');
        expect(dnsBlock).toContain('port: 53');
    });

    it('omits default-deny when defaultDeny=false', async () => {
        const yaml = await renderYaml({ defaultDeny: false });
        expect(yaml).not.toContain('default-deny');
    });

    it('omits intra-ns when allowIntraNamespace=false', async () => {
        const yaml = await renderYaml({ allowIntraNamespace: false });
        expect(yaml).not.toContain('allow-intra-namespace');
    });

    it('omits DNS when allowDns=false', async () => {
        const yaml = await renderYaml({ allowDns: false });
        expect(yaml).not.toContain('allow-dns');
    });

    it('emits external-egress only when allowExternalEgress=true', async () => {
        const noExt = await renderYaml();
        expect(noExt).not.toContain('allow-external-egress');

        const withExt = await renderYaml({ allowExternalEgress: true });
        expect(withExt).toContain('alluneed-netpol-allow-external-egress');
        expect(withExt).toContain('cidr: 0.0.0.0/0');
        expect(withExt).toContain('10.0.0.0/8');
        expect(withExt).toContain('172.16.0.0/12');
        expect(withExt).toContain('192.168.0.0/16');
    });

    // ── Custom rules ────────────────────────────────────────────────────────

    it('compiles a cross-namespace ingress rule with pod label In selector', async () => {
        const yaml = await renderYaml({
            ingress: [{
                name: 'from-trinity',
                podSelector: { matchLabels: { app: 'alluneed' } },
                from: [{
                    namespace: 'trinity',
                    podSelector: {
                        matchExpressions: [{
                            key: 'app',
                            operator: 'In',
                            values: ['trinity-web', 'trinity-worker'],
                        }],
                    },
                }],
                ports: [{ port: 8000 }],
            }],
        });

        expect(yaml).toContain('alluneed-netpol-from-trinity');
        expect(yaml).toContain('matchLabels:');
        expect(yaml).toContain('app: alluneed');
        expect(yaml).toContain('kubernetes.io/metadata.name: trinity');
        expect(yaml).toContain('matchExpressions:');
        expect(yaml).toContain('operator: In');
        expect(yaml).toContain('- trinity-web');
        expect(yaml).toContain('- trinity-worker');
        expect(yaml).toContain('port: 8000');
        expect(yaml).toContain('protocol: TCP');
    });

    it('compiles `sameNamespace: true` to a namespaceSelector for the current ns', async () => {
        const yaml = await renderYaml({
            ingress: [{
                name: 'from-self',
                from: [{ sameNamespace: true }],
                ports: [{ port: 8000 }],
            }],
        });
        expect(yaml).toContain('kubernetes.io/metadata.name: alluneed');
    });

    it('compiles an egress rule to observability:4318', async () => {
        const yaml = await renderYaml({
            egress: [{
                name: 'to-otel',
                to: [{ namespace: 'observability' }],
                ports: [{ port: 4318 }],
            }],
        });
        const block = yaml.match(/name: alluneed-netpol-to-otel[\s\S]*?(?=\n---|\n*$)/)?.[0] ?? '';
        expect(block).toContain('kubernetes.io/metadata.name: observability');
        expect(block).toContain('port: 4318');
        expect(block).toMatch(/policyTypes:[\s\S]*?- Egress/);
    });

    it('compiles an egress ipBlock peer with except', async () => {
        const yaml = await renderYaml({
            egress: [{
                name: 'public-internet',
                to: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] } }],
            }],
        });
        const block = yaml.match(/name: alluneed-netpol-public-internet[\s\S]*?(?=\n---|\n*$)/)?.[0] ?? '';
        expect(block).toContain('cidr: 0.0.0.0/0');
        expect(block).toContain('except:');
        expect(block).toContain('10.0.0.0/8');
    });

    it('uses TCP as default protocol when not specified', async () => {
        const yaml = await renderYaml({
            ingress: [{
                name: 'tcp-default',
                from: [{ sameNamespace: true }],
                ports: [{ port: 80 }],
            }],
        });
        const block = yaml.match(/name: alluneed-netpol-tcp-default[\s\S]*?(?=\n---|\n*$)/)?.[0] ?? '';
        expect(block).toContain('protocol: TCP');
    });

    // ── Bare config / manifest validity ──────────────────────────────────────

    it('every emitted manifest declares networking.k8s.io/v1 + NetworkPolicy', async () => {
        const yaml = await renderYaml({ allowExternalEgress: true });
        const docs = yaml.split(/\n---\n/);
        expect(docs.length).toBeGreaterThan(0);
        for (const doc of docs) {
            expect(doc).toContain('apiVersion: networking.k8s.io/v1');
            expect(doc).toContain('kind: NetworkPolicy');
            expect(doc).toContain('namespace: alluneed');
        }
    });

    it('attaches custom labels to every emitted policy', async () => {
        const yaml = await renderYaml({ labels: { 'managed-by': 'merlin' } });
        const docs = yaml.split(/\n---\n/);
        for (const doc of docs) {
            expect(doc).toContain('managed-by: merlin');
        }
    });

    it('produces a single doc when only default-deny is enabled', async () => {
        const yaml = await renderYaml({ allowDns: false, allowIntraNamespace: false });
        expect(countDocuments(yaml)).toBe(1);
        expect(yaml).toContain('alluneed-netpol-default-deny');
    });
});
