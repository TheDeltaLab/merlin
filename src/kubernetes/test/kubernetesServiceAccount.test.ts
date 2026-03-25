import { describe, it, expect } from 'vitest';
import { KubernetesServiceAccountRender, KUBERNETES_SERVICE_ACCOUNT_TYPE } from '../kubernetesServiceAccount.js';
import { Resource } from '../../common/resource.js';

describe('KubernetesServiceAccountRender', () => {
    const render = new KubernetesServiceAccountRender();

    function makeSAResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-workload-sa',
            type: KUBERNETES_SERVICE_ACCOUNT_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8ssa', () => {
        expect(render.getShortResourceTypeName()).toBe('k8ssa');
    });

    it('renders kubectl apply with ServiceAccount manifest', async () => {
        const resource = makeSAResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].args).toContain('apply');
        expect(commands[0].args).toContain('__MERLIN_YAML_FILE__');
        expect(commands[0].fileContent).toContain('kind: ServiceAccount');
        expect(commands[0].fileContent).toContain('name: trinity-workload-sa');
        expect(commands[0].fileContent).toContain('namespace: trinity');
    });

    it('uses apiVersion v1', async () => {
        const resource = makeSAResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('apiVersion: v1');
    });

    it('includes annotations when configured', async () => {
        const resource = makeSAResource({
            annotations: {
                'azure.workload.identity/client-id': 'test-client-id-12345',
            },
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('azure.workload.identity/client-id');
        expect(commands[0].fileContent).toContain('test-client-id-12345');
    });

    it('includes labels when configured', async () => {
        const resource = makeSAResource({ labels: { team: 'platform' } });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('team: platform');
    });

    it('throws for wrong resource type', async () => {
        const resource = makeSAResource();
        resource.type = 'WrongType';
        await expect(render.render(resource)).rejects.toThrow('not a KubernetesServiceAccount resource');
    });
});
