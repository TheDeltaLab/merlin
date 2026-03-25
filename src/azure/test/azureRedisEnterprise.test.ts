import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureRedisEnterpriseRender,
    AzureRedisEnterpriseResource,
    AzureRedisEnterpriseConfig,
    AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE,
} from '../azureRedisEnterprise.js';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

function makeResource(
    config: Partial<AzureRedisEnterpriseConfig> = {},
    overrides: Partial<Omit<AzureRedisEnterpriseResource, 'config'>> = {}
): AzureRedisEnterpriseResource {
    return {
        name: 'shared',
        type: AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        project: 'merlin',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            sku: 'Balanced_B1',
            location: 'koreacentral',
            ...config,
        },
        ...overrides,
    } as AzureRedisEnterpriseResource;
}

function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

function findCreate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'redisenterprise' && c.args[1] === 'create');
}

function findUpdate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'redisenterprise' && c.args[1] === 'update');
}

function mockNotFound(): void {
    mockExecSync.mockImplementation(() => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

function mockExists(): void {
    mockExecSync.mockImplementation((cmd: string) => {
        const c = String(cmd);
        if (c.includes('group show')) {
            return JSON.stringify({ name: 'merlin-rg-stg-krc' }) as any;
        }
        return JSON.stringify({
            sku: { name: 'Balanced_B1' },
            location: 'koreacentral',
            tags: {},
        }) as any;
    });
}

describe('AzureRedisEnterpriseRender', () => {
    let render: AzureRedisEnterpriseRender;

    beforeEach(() => {
        render = new AzureRedisEnterpriseRender();
        vi.resetAllMocks();
    });

    it('getShortResourceTypeName returns redis', () => {
        expect(render.getShortResourceTypeName()).toBe('redis');
    });

    it('supportConnectorInResourceName is false', () => {
        expect(render.supportConnectorInResourceName).toBe(false);
    });

    it('derives correct resource name', () => {
        const resource = makeResource();
        expect(render.getResourceName(resource)).toBe('merlinsharedstgkrcredis');
    });

    describe('renderCreate', () => {
        beforeEach(() => mockNotFound());

        it('emits az redisenterprise create with required flags', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands);
            expect(cmd).toBeDefined();
            expect(hasParam(cmd!.args, '--name', 'merlinsharedstgkrcredis')).toBe(true);
            expect(hasParam(cmd!.args, '--resource-group', 'merlin-rg-stg-krc')).toBe(true);
        });

        it('includes --sku on create', async () => {
            const resource = makeResource({ sku: 'Enterprise_E10' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--sku', 'Enterprise_E10')).toBe(true);
        });

        it('includes --location on create', async () => {
            const resource = makeResource({ location: 'eastasia' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--location', 'eastasia')).toBe(true);
        });

        it('includes --capacity on create', async () => {
            const resource = makeResource({ capacity: 4 });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--capacity', '4')).toBe(true);
        });

        it('includes --client-protocol on create', async () => {
            const resource = makeResource({ clientProtocol: 'Encrypted' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--client-protocol', 'Encrypted')).toBe(true);
        });

        it('includes --clustering-policy on create', async () => {
            const resource = makeResource({ clusteringPolicy: 'OSSCluster' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--clustering-policy', 'OSSCluster')).toBe(true);
        });

        it('includes --port on create', async () => {
            const resource = makeResource({ port: 10000 });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--port', '10000')).toBe(true);
        });

        it('includes --zones on create', async () => {
            const resource = makeResource({ zones: ['1', '2', '3'] });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(cmd.args).toContain('--zones');
            expect(cmd.args).toContain('1');
            expect(cmd.args).toContain('2');
            expect(cmd.args).toContain('3');
        });

        it('includes --tags on create', async () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
        });
    });

    describe('renderUpdate', () => {
        beforeEach(() => mockExists());

        it('emits az redisenterprise update', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findUpdate(commands);
            expect(cmd).toBeDefined();
        });

        it('does not include create-only flags on update', async () => {
            const resource = makeResource({
                location: 'eastasia',
                clientProtocol: 'Encrypted',
                clusteringPolicy: 'OSSCluster',
                capacity: 4,
            });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(cmd.args).not.toContain('--location');
            expect(cmd.args).not.toContain('--client-protocol');
            expect(cmd.args).not.toContain('--clustering-policy');
            expect(cmd.args).not.toContain('--capacity');
        });

        it('includes --tags on update', async () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
        });
    });

    describe('getDeployedProps', () => {
        it('returns undefined for exit code 1 (not found)', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('not found');
                err.status = 1;
                throw err;
            });
            const resource = makeResource();
            const commands = await render.render(resource);
            expect(findCreate(commands)).toBeDefined();
        });

        it('throws on unexpected errors', async () => {
            // First call succeeds (resource group), second call fails with unexpected error
            let callCount = 0;
            mockExecSync.mockImplementation(() => {
                callCount++;
                if (callCount <= 1) {
                    return JSON.stringify({ name: 'merlin-rg-stg-krc' }) as any;
                }
                const err: any = new Error('NetworkError');
                err.status = 99;
                throw err;
            });
            const resource = makeResource();
            await expect(render.render(resource)).rejects.toThrow('Failed to get deployed properties');
        });
    });

    it('throws for wrong resource type', async () => {
        mockNotFound();
        const resource = makeResource({}, { type: 'WrongType' } as any);
        await expect(render.render(resource)).rejects.toThrow('not an AzureRedisEnterprise resource');
    });
});
