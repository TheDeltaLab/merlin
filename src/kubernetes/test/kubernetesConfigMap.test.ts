import { describe, it, expect } from 'vitest';
import { KubernetesConfigMapRender, KUBERNETES_CONFIG_MAP_TYPE } from '../kubernetesConfigMap.js';
import { Resource } from '../../common/resource.js';

describe('KubernetesConfigMapRender', () => {
    const render = new KubernetesConfigMapRender();

    function makeConfigMapResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-shared-config',
            type: KUBERNETES_CONFIG_MAP_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                data: {
                    REDIS_URL: 'redis://redis.example.com:6380',
                    ADMIN_SERVER_URL: 'http://trinity-admin.trinity.svc.cluster.local:3000',
                },
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8scm', () => {
        expect(render.getShortResourceTypeName()).toBe('k8scm');
    });

    it('renders kubectl apply with ConfigMap manifest', async () => {
        const resource = makeConfigMapResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].args).toContain('apply');
        expect(commands[0].args).toContain('__MERLIN_YAML_FILE__');
        expect(commands[0].fileContent).toContain('kind: ConfigMap');
        expect(commands[0].fileContent).toContain('name: trinity-shared-config');
        expect(commands[0].fileContent).toContain('namespace: trinity');
    });

    it('includes data key-value pairs', async () => {
        const resource = makeConfigMapResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('REDIS_URL');
        expect(commands[0].fileContent).toContain('redis://redis.example.com:6380');
        expect(commands[0].fileContent).toContain('ADMIN_SERVER_URL');
    });

    it('uses apiVersion v1', async () => {
        const resource = makeConfigMapResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('apiVersion: v1');
    });

    it('includes labels when configured', async () => {
        const resource = makeConfigMapResource({ labels: { team: 'platform' } });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('team: platform');
    });

    it('includes annotations when configured', async () => {
        const resource = makeConfigMapResource({ annotations: { owner: 'merlin' } });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('owner: merlin');
    });

    it('throws for wrong resource type', async () => {
        const resource = makeConfigMapResource();
        resource.type = 'WrongType';
        await expect(render.render(resource)).rejects.toThrow('not a KubernetesConfigMap resource');
    });
});
