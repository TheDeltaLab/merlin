import { describe, it, expect } from 'vitest';
import { KubernetesIngressRender, KUBERNETES_INGRESS_TYPE } from '../kubernetesIngress.js';
import { Resource } from '../../common/resource.js';

describe('KubernetesIngressRender', () => {
    const render = new KubernetesIngressRender();

    function makeIngressResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-web',
            type: KUBERNETES_INGRESS_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                ingressClassName: 'nginx',
                clusterIssuer: 'letsencrypt-prod',
                rules: [
                    {
                        host: 'web.staging.thebrainly.dev',
                        paths: [{
                            path: '/',
                            pathType: 'Prefix',
                            serviceName: 'trinity-web',
                            servicePort: 3000,
                        }],
                    },
                ],
                tls: [{
                    hosts: ['web.staging.thebrainly.dev'],
                    secretName: 'trinity-web-tls',
                }],
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8sing', () => {
        expect(render.getShortResourceTypeName()).toBe('k8sing');
    });

    it('renders kubectl apply with Ingress manifest', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].args).toContain('apply');
        expect(commands[0].fileContent).toContain('kind: Ingress');
        expect(commands[0].fileContent).toContain('name: trinity-web');
        expect(commands[0].fileContent).toContain('namespace: trinity');
    });

    it('includes cert-manager annotation when clusterIssuer is set', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('cert-manager.io/cluster-issuer: letsencrypt-prod');
    });

    it('throws for wrong resource type', async () => {
        const resource = makeIngressResource();
        resource.type = 'WrongType';
        await expect(render.render(resource)).rejects.toThrow('not a KubernetesIngress resource');
    });

    // ── bindDnsZone tests ───────────────────────────────────────────────────

    it('does not generate DNS commands when bindDnsZone is not configured', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        // Only the kubectl apply command
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
    });

    it('generates DNS commands when bindDnsZone is configured', async () => {
        const resource = makeIngressResource({
            bindDnsZone: { dnsZone: 'thebrainly.dev' },
        });
        const commands = await render.render(resource);

        // 1 kubectl apply + 1 LB IP capture + 1 DNS zone RG capture + 1 A record = 4
        expect(commands).toHaveLength(4);

        // Command 0: kubectl apply
        expect(commands[0].command).toBe('kubectl');

        // Command 1: capture LB IP
        expect(commands[1].command).toBe('kubectl');
        expect(commands[1].args).toContain('get');
        expect(commands[1].args).toContain('svc');
        expect(commands[1].args).toContain('ingress-nginx-controller');
        expect(commands[1].args).toContain('-n');
        expect(commands[1].args).toContain('ingress-nginx');
        expect(commands[1].envCapture).toContain('LB_IP');

        // Command 2: capture DNS zone RG
        expect(commands[2].command).toBe('az');
        expect(commands[2].args).toContain('dns');
        expect(commands[2].args).toContain('zone');
        expect(commands[2].args).toContain('list');
        expect(commands[2].envCapture).toContain('DNS_ZONE_RG');

        // Command 3: create A record
        expect(commands[3].command).toBe('bash');
        const bashCmd = commands[3].args[1];
        expect(bashCmd).toContain('add-record');
        expect(bashCmd).toContain('web.staging');
        expect(bashCmd).toContain('thebrainly.dev');
    });

    it('generates A records for multiple hosts', async () => {
        const resource = makeIngressResource({
            rules: [
                {
                    host: 'web.staging.thebrainly.dev',
                    paths: [{ path: '/', pathType: 'Prefix', serviceName: 'web', servicePort: 3000 }],
                },
                {
                    host: 'api.staging.thebrainly.dev',
                    paths: [{ path: '/', pathType: 'Prefix', serviceName: 'api', servicePort: 8000 }],
                },
            ],
            bindDnsZone: { dnsZone: 'thebrainly.dev' },
        });
        const commands = await render.render(resource);

        // 1 kubectl + 1 LB IP + 1 DNS RG + 2 A records = 5
        expect(commands).toHaveLength(5);

        // Two bash commands for DNS records
        const dnsCommands = commands.filter(c => c.command === 'bash');
        expect(dnsCommands).toHaveLength(2);
        expect(dnsCommands[0].args[1]).toContain('web.staging');
        expect(dnsCommands[1].args[1]).toContain('api.staging');
    });

    it('deduplicates hosts across rules', async () => {
        const resource = makeIngressResource({
            rules: [
                {
                    host: 'web.staging.thebrainly.dev',
                    paths: [{ path: '/', pathType: 'Prefix', serviceName: 'web', servicePort: 3000 }],
                },
                {
                    host: 'web.staging.thebrainly.dev',
                    paths: [{ path: '/api', pathType: 'Prefix', serviceName: 'api', servicePort: 8000 }],
                },
            ],
            bindDnsZone: { dnsZone: 'thebrainly.dev' },
        });
        const commands = await render.render(resource);

        // 1 kubectl + 1 LB IP + 1 DNS RG + 1 A record (deduplicated) = 4
        expect(commands).toHaveLength(4);
    });

    it('throws when host does not end with dnsZone', async () => {
        const resource = makeIngressResource({
            rules: [{
                host: 'web.staging.otherdomain.com',
                paths: [{ path: '/', pathType: 'Prefix', serviceName: 'web', servicePort: 3000 }],
            }],
            bindDnsZone: { dnsZone: 'thebrainly.dev' },
        });
        await expect(render.render(resource)).rejects.toThrow(
            'does not end with DNS zone'
        );
    });

    it('uses custom ingress service name and namespace', async () => {
        const resource = makeIngressResource({
            bindDnsZone: {
                dnsZone: 'thebrainly.dev',
                ingressServiceName: 'my-nginx',
                ingressNamespace: 'custom-ns',
            },
        });
        const commands = await render.render(resource);

        // LB IP capture command should use custom service name/namespace
        expect(commands[1].args).toContain('my-nginx');
        expect(commands[1].args).toContain('custom-ns');
    });
});
