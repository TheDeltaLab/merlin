import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureAKSRender,
    KubernetesClusterConfig,
    KubernetesClusterResource,
    KUBERNETES_CLUSTER_TYPE,
    AZURE_AKS_TYPE,
} from '../kubernetesCluster.js';

// Mock execAsync so it is replaceable in tests
vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, execAsync: vi.fn() };
});

import { execAsync } from '../../common/constants.js';
const mockExecAsync = vi.mocked(execAsync);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<KubernetesClusterConfig> = {},
    overrides: Partial<Omit<KubernetesClusterResource, 'config'>> = {}
): KubernetesClusterResource {
    return {
        name: 'main',
        type: KUBERNETES_CLUSTER_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        project: 'myproject',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            nodeCount: 2,
            nodeVmSize: 'Standard_DS2_v2',
            enableManagedIdentity: true,
            location: 'koreacentral',
            ...config,
        },
        ...overrides,
    } as KubernetesClusterResource;
}

function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

function findAksCreate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'aks' && c.args[1] === 'create');
}

function findAksUpdate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'aks' && c.args[1] === 'update');
}

function mockNotFound(): void {
    mockExecAsync.mockImplementation(async () => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

function mockClusterExists(props: object = {}): void {
    mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('group') && args.includes('show')) {
            return JSON.stringify({ name: 'myproject-rg-stg-krc' });
        }
        // aks show
        return JSON.stringify({
            currentKubernetesVersion: '1.29.2',
            agentPoolProfiles: [{ count: 2, vmSize: 'Standard_DS2_v2', name: 'nodepool1' }],
            networkProfile: { networkPlugin: 'azure', networkPolicy: 'azure' },
            tags: {},
            ...props,
        });
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureAKSRender', () => {
    let render: AzureAKSRender;

    beforeEach(() => {
        render = new AzureAKSRender();
        vi.resetAllMocks();
    });

    // ── 1. Metadata ───────────────────────────────────────────────────────────

    it('getShortResourceTypeName returns aks', () => {
        expect(render.getShortResourceTypeName()).toBe('aks');
    });

    it('supportConnectorInResourceName is true', () => {
        expect(render.supportConnectorInResourceName).toBe(true);
    });

    it('derives correct resource name', () => {
        const resource = makeResource();
        expect(render.getResourceName(resource)).toBe('myproject-main-stg-krc-aks');
    });

    it('derives correct resource name without project (shared)', () => {
        const resource = makeResource({}, { project: undefined });
        expect(render.getResourceName(resource)).toBe('shared-main-stg-krc-aks');
    });

    it('accepts AZURE_AKS_TYPE as resource type', () => {
        const resource = makeResource({}, { type: AZURE_AKS_TYPE });
        mockNotFound();
        expect(async () => render.render(resource)).not.toThrow();
    });

    // ── 2. renderCreate ───────────────────────────────────────────────────────

    describe('renderCreate', () => {
        beforeEach(() => mockNotFound());

        it('emits az aks create with required flags', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands);
            expect(cmd).toBeDefined();
            expect(hasParam(cmd!.args, '--name', 'myproject-main-stg-krc-aks')).toBe(true);
            expect(hasParam(cmd!.args, '--resource-group', 'myproject-rg-stg-krc')).toBe(true);
        });

        it('includes --node-count', async () => {
            const resource = makeResource({ nodeCount: 3 });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(hasParam(cmd.args, '--node-count', '3')).toBe(true);
        });

        it('includes --node-vm-size on create', async () => {
            const resource = makeResource({ nodeVmSize: 'Standard_D4s_v3' });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(hasParam(cmd.args, '--node-vm-size', 'Standard_D4s_v3')).toBe(true);
        });

        it('includes --kubernetes-version when set', async () => {
            const resource = makeResource({ kubernetesVersion: '1.29.2' });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(hasParam(cmd.args, '--kubernetes-version', '1.29.2')).toBe(true);
        });

        it('includes --enable-managed-identity when set', async () => {
            const resource = makeResource({ enableManagedIdentity: true });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--enable-managed-identity');
        });

        it('includes autoscaling flags when enableAutoScaling is true', async () => {
            const resource = makeResource({ enableAutoScaling: true, minCount: 1, maxCount: 5 });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--enable-cluster-autoscaler');
            expect(hasParam(cmd.args, '--min-count', '1')).toBe(true);
            expect(hasParam(cmd.args, '--max-count', '5')).toBe(true);
        });

        it('does not include min/max count when enableAutoScaling is false', async () => {
            const resource = makeResource({ enableAutoScaling: false, minCount: 1, maxCount: 5 });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).not.toContain('--min-count');
            expect(cmd.args).not.toContain('--max-count');
        });

        it('includes --no-wait when noWait is true', async () => {
            const resource = makeResource({ noWait: true });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--no-wait');
        });

        it('includes --tags when set', async () => {
            const resource = makeResource({ tags: { env: 'staging', merlin: 'true' } });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
            expect(cmd.args).toContain('merlin=true');
        });

        it('appends get-credentials after create', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const credsCmd = commands.find(c => c.command === 'az' && c.args.includes('get-credentials'));
            expect(credsCmd).toBeDefined();
            expect(hasParam(credsCmd!.args, '--name', 'myproject-main-stg-krc-aks')).toBe(true);
            expect(credsCmd!.args).toContain('--overwrite-existing');
        });

        it('does not emit namespace commands (namespace creation moved to individual resource renders)', async () => {
            const resource = makeResource({ namespaces: ['trinity', 'alluneed'] });
            const commands = await render.render(resource);
            const nsCmds = commands.filter(c => c.command === 'bash' && c.args.some(a => a.includes('create namespace')));
            expect(nsCmds).toHaveLength(0);
        });

        it('does not emit namespace commands when namespaces is empty', async () => {
            const resource = makeResource({ namespaces: [] });
            const commands = await render.render(resource);
            const nsCmds = commands.filter(c => c.command === 'bash');
            expect(nsCmds).toHaveLength(0);
        });

        // ── CSI / OIDC / Workload Identity on create ─────────────────────────

        it('includes --enable-oidc-issuer on create when enableOidcIssuer is true', async () => {
            const resource = makeResource({ enableOidcIssuer: true });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--enable-oidc-issuer');
        });

        it('includes --enable-workload-identity on create when enableWorkloadIdentity is true', async () => {
            const resource = makeResource({ enableWorkloadIdentity: true });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--enable-workload-identity');
        });

        it('includes --enable-addons azure-keyvault-secrets-provider on create when enableCsiSecretProvider is true', async () => {
            const resource = makeResource({ enableCsiSecretProvider: true });
            const commands = await render.render(resource);
            const cmd = findAksCreate(commands)!;
            expect(cmd.args).toContain('--enable-addons');
            expect(cmd.args).toContain('azure-keyvault-secrets-provider');
        });

        it('emits secret rotation command after create when enableSecretRotation and enableCsiSecretProvider are both true', async () => {
            const resource = makeResource({ enableCsiSecretProvider: true, enableSecretRotation: true });
            const commands = await render.render(resource);
            const rotationCmd = commands.find(c =>
                c.command === 'bash' && c.args.some(a => a.includes('--enable-secret-rotation'))
            );
            expect(rotationCmd).toBeDefined();
        });

        it('does not emit secret rotation command when enableCsiSecretProvider is false', async () => {
            const resource = makeResource({ enableCsiSecretProvider: false, enableSecretRotation: true });
            const commands = await render.render(resource);
            const rotationCmd = commands.find(c =>
                c.command === 'bash' && c.args.some(a => a.includes('--enable-secret-rotation'))
            );
            expect(rotationCmd).toBeUndefined();
        });
    });

    // ── 3. renderUpdate ───────────────────────────────────────────────────────

    describe('renderUpdate', () => {
        beforeEach(() => mockClusterExists());

        it('emits az aks update when cluster already exists', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands);
            expect(cmd).toBeDefined();
            expect(cmd!.args[0]).toBe('aks');
        });

        it('does not include create-only flags on update (nodeVmSize, location)', async () => {
            const resource = makeResource({ nodeVmSize: 'Standard_D4s_v3', location: 'koreacentral' });
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands)!;
            expect(cmd.args).not.toContain('--node-vm-size');
            expect(cmd.args).not.toContain('--location');
        });

        it('appends get-credentials after update', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const credsCmd = commands.find(c => c.command === 'az' && c.args.includes('get-credentials'));
            expect(credsCmd).toBeDefined();
        });

        // ── CSI / OIDC / Workload Identity on update ─────────────────────────

        it('includes --enable-oidc-issuer on update when enableOidcIssuer is true', async () => {
            const resource = makeResource({ enableOidcIssuer: true });
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands)!;
            expect(cmd.args).toContain('--enable-oidc-issuer');
        });

        it('includes --enable-workload-identity on update when enableWorkloadIdentity is true', async () => {
            const resource = makeResource({ enableWorkloadIdentity: true });
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands)!;
            expect(cmd.args).toContain('--enable-workload-identity');
        });

        it('emits CSI addon enable command on update when enableCsiSecretProvider is true', async () => {
            const resource = makeResource({ enableCsiSecretProvider: true });
            const commands = await render.render(resource);
            const csiCmd = commands.find(c =>
                c.command === 'bash' && c.args.some(a => a.includes('enable-addons') && a.includes('azure-keyvault-secrets-provider'))
            );
            expect(csiCmd).toBeDefined();
        });

        it('emits secret rotation command on update when both CSI and rotation enabled', async () => {
            const resource = makeResource({ enableCsiSecretProvider: true, enableSecretRotation: true });
            const commands = await render.render(resource);
            const rotationCmd = commands.find(c =>
                c.command === 'bash' && c.args.some(a => a.includes('--enable-secret-rotation'))
            );
            expect(rotationCmd).toBeDefined();
        });

        it('includes --network-policy on update when networkPolicy is set', async () => {
            const resource = makeResource({ networkPolicy: 'azure' });
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands)!;
            expect(cmd.args).toContain('--network-policy');
            expect(cmd.args[cmd.args.indexOf('--network-policy') + 1]).toBe('azure');
        });

        it('does not include --network-policy on update when not set', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findAksUpdate(commands)!;
            expect(cmd.args).not.toContain('--network-policy');
        });
    });

    // ── 4. renderGetCredentials ───────────────────────────────────────────────

    it('renderGetCredentials returns az aks get-credentials', () => {
        const resource = makeResource();
        const cmds = render.renderGetCredentials(resource as KubernetesClusterResource);
        expect(cmds).toHaveLength(1);
        expect(cmds[0].command).toBe('az');
        expect(cmds[0].args).toContain('get-credentials');
        expect(cmds[0].args).toContain('--overwrite-existing');
    });
});
