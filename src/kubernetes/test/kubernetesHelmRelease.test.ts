import { describe, it, expect } from 'vitest';
import { KubernetesHelmReleaseRender, KUBERNETES_HELM_RELEASE_TYPE } from '../kubernetesHelmRelease.js';
import { Resource } from '../../common/resource.js';

const render = new KubernetesHelmReleaseRender();

function makeResource(config: Record<string, unknown> = {}): Resource {
    return {
        name: 'ingress-nginx',
        type: KUBERNETES_HELM_RELEASE_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        authProvider: undefined,
        dependencies: [],
        exports: {},
        config: {
            releaseName: 'ingress-nginx',
            chart: 'ingress-nginx/ingress-nginx',
            repoName: 'ingress-nginx',
            repoUrl: 'https://kubernetes.github.io/ingress-nginx',
            namespace: 'ingress-nginx',
            ...config,
        },
    };
}

describe('KubernetesHelmReleaseRender', () => {
    it('getShortResourceTypeName returns k8shelm', () => {
        expect(render.getShortResourceTypeName()).toBe('k8shelm');
    });

    it('emits helm repo add as first command', async () => {
        const commands = await render.render(makeResource());
        expect(commands[0].command).toBe('helm');
        expect(commands[0].args).toEqual(['repo', 'add', 'ingress-nginx', 'https://kubernetes.github.io/ingress-nginx']);
    });

    it('emits helm repo update as second command', async () => {
        const commands = await render.render(makeResource());
        expect(commands[1].command).toBe('helm');
        expect(commands[1].args).toEqual(['repo', 'update']);
    });

    it('emits helm upgrade --install as third command', async () => {
        const commands = await render.render(makeResource());
        const installCmd = commands[2];
        expect(installCmd.command).toBe('helm');
        expect(installCmd.args[0]).toBe('upgrade');
        expect(installCmd.args[1]).toBe('--install');
        expect(installCmd.args[2]).toBe('ingress-nginx');
        expect(installCmd.args[3]).toBe('ingress-nginx/ingress-nginx');
    });

    it('includes --namespace', async () => {
        const commands = await render.render(makeResource());
        const args = commands[2].args;
        const idx = args.indexOf('--namespace');
        expect(idx).toBeGreaterThan(-1);
        expect(args[idx + 1]).toBe('ingress-nginx');
    });

    it('includes --create-namespace by default', async () => {
        const commands = await render.render(makeResource());
        expect(commands[2].args).toContain('--create-namespace');
    });

    it('omits --create-namespace when createNamespace is false', async () => {
        const commands = await render.render(makeResource({ createNamespace: false }));
        expect(commands[2].args).not.toContain('--create-namespace');
    });

    it('includes --version when set', async () => {
        const commands = await render.render(makeResource({ version: '4.10.0' }));
        const args = commands[2].args;
        const idx = args.indexOf('--version');
        expect(idx).toBeGreaterThan(-1);
        expect(args[idx + 1]).toBe('4.10.0');
    });

    it('omits --version when not set', async () => {
        const commands = await render.render(makeResource());
        expect(commands[2].args).not.toContain('--version');
    });

    it('includes --set key=value pairs', async () => {
        const commands = await render.render(makeResource({
            set: [
                { key: 'controller.replicaCount', value: '2' },
                { key: 'controller.service.type', value: 'LoadBalancer' },
            ],
        }));
        const args = commands[2].args;
        expect(args).toContain('--set');
        expect(args).toContain('controller.replicaCount=2');
        expect(args).toContain('controller.service.type=LoadBalancer');
    });

    it('includes --set-string pairs', async () => {
        const commands = await render.render(makeResource({
            setString: [{ key: 'controller.image.tag', value: 'v1.9.0' }],
        }));
        const args = commands[2].args;
        expect(args).toContain('--set-string');
        expect(args).toContain('controller.image.tag=v1.9.0');
    });

    it('includes --wait when wait is true', async () => {
        const commands = await render.render(makeResource({ wait: true }));
        expect(commands[2].args).toContain('--wait');
    });

    it('includes --timeout when wait and timeout are set', async () => {
        const commands = await render.render(makeResource({ wait: true, timeout: '5m0s' }));
        const args = commands[2].args;
        expect(args).toContain('--timeout');
        expect(args[args.indexOf('--timeout') + 1]).toBe('5m0s');
    });

    it('omits --timeout when wait is false', async () => {
        const commands = await render.render(makeResource({ wait: false, timeout: '5m0s' }));
        expect(commands[2].args).not.toContain('--timeout');
    });

    it('always produces exactly 3 commands (repo add, repo update, upgrade)', async () => {
        const commands = await render.render(makeResource());
        expect(commands).toHaveLength(3);
    });

    it('includes --values with fileContent when values object is provided', async () => {
        const commands = await render.render(makeResource({
            values: {
                controller: {
                    service: {
                        annotations: {
                            'service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path': '/healthz',
                        },
                    },
                },
            },
        }));
        const installCmd = commands[2];
        expect(installCmd.args).toContain('--values');
        expect(installCmd.args).toContain('__MERLIN_YAML_FILE__');
        expect(installCmd.fileContent).toBeDefined();
        expect(installCmd.fileContent).toContain('controller:');
        expect(installCmd.fileContent).toContain('/healthz');
    });

    it('omits --values when values is empty object', async () => {
        const commands = await render.render(makeResource({ values: {} }));
        const installCmd = commands[2];
        expect(installCmd.args).not.toContain('--values');
        expect(installCmd.fileContent).toBeUndefined();
    });

    it('omits --values when values is not set', async () => {
        const commands = await render.render(makeResource());
        const installCmd = commands[2];
        expect(installCmd.args).not.toContain('--values');
        expect(installCmd.fileContent).toBeUndefined();
    });
});
