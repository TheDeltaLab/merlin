import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzurePostgreSQLFlexibleRender,
    AzurePostgreSQLFlexibleResource,
    AzurePostgreSQLFlexibleConfig,
    AZURE_POSTGRESQL_RESOURCE_TYPE,
} from '../azurePostgreSQLFlexible.js';

vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, execAsync: vi.fn() };
});

import { execAsync } from '../../common/constants.js';
const mockExecAsync = vi.mocked(execAsync);

function makeResource(
    config: Partial<AzurePostgreSQLFlexibleConfig> = {},
    overrides: Partial<Omit<AzurePostgreSQLFlexibleResource, 'config'>> = {}
): AzurePostgreSQLFlexibleResource {
    return {
        name: 'shared',
        type: AZURE_POSTGRESQL_RESOURCE_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        project: 'merlin',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            location: 'koreacentral',
            skuName: 'Standard_D2ds_v4',
            tier: 'GeneralPurpose',
            storageSizeGb: 32,
            version: '16',
            ...config,
        },
        ...overrides,
    } as AzurePostgreSQLFlexibleResource;
}

function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

function findCreate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args.includes('flexible-server') && c.args.includes('create'));
}

function findUpdate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args.includes('flexible-server') && c.args.includes('update'));
}

function mockNotFound(): void {
    mockExecAsync.mockImplementation(async () => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

function mockExists(): void {
    mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('group') && args.includes('show')) {
            return JSON.stringify({ name: 'merlin-rg-stg-krc' });
        }
        return JSON.stringify({
            sku: { name: 'Standard_D2ds_v4', tier: 'GeneralPurpose' },
            storage: { storageSizeGb: 32 },
            version: '16',
            tags: {},
        });
    });
}

describe('AzurePostgreSQLFlexibleRender', () => {
    let render: AzurePostgreSQLFlexibleRender;

    beforeEach(() => {
        render = new AzurePostgreSQLFlexibleRender();
        vi.resetAllMocks();
    });

    it('getShortResourceTypeName returns psql', () => {
        expect(render.getShortResourceTypeName()).toBe('psql');
    });

    it('supportConnectorInResourceName is false', () => {
        expect(render.supportConnectorInResourceName).toBe(false);
    });

    it('derives correct resource name', () => {
        const resource = makeResource();
        expect(render.getResourceName(resource)).toBe('merlinsharedstgkrcpsql');
    });

    describe('renderCreate', () => {
        beforeEach(() => mockNotFound());

        it('emits az postgres flexible-server create', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands);
            expect(cmd).toBeDefined();
            expect(cmd!.args.slice(0, 3)).toEqual(['postgres', 'flexible-server', 'create']);
        });

        it('includes --name and --resource-group', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--name', 'merlinsharedstgkrcpsql')).toBe(true);
            expect(hasParam(cmd.args, '--resource-group', 'merlin-rg-stg-krc')).toBe(true);
        });

        it('includes --sku-name on create', async () => {
            const resource = makeResource({ skuName: 'Standard_B2ms' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--sku-name', 'Standard_B2ms')).toBe(true);
        });

        it('includes --tier on create', async () => {
            const resource = makeResource({ tier: 'Burstable' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--tier', 'Burstable')).toBe(true);
        });

        it('includes --storage-size on create', async () => {
            const resource = makeResource({ storageSizeGb: 64 });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--storage-size', '64')).toBe(true);
        });

        it('includes --version on create', async () => {
            const resource = makeResource({ version: '16' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--version', '16')).toBe(true);
        });

        it('includes --location on create', async () => {
            const resource = makeResource({ location: 'eastasia' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--location', 'eastasia')).toBe(true);
        });

        it('includes --yes to skip prompts', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(cmd.args).toContain('--yes');
        });

        it('includes --backup-retention on create', async () => {
            const resource = makeResource({ backupRetention: 14 });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--backup-retention', '14')).toBe(true);
        });

        it('includes --high-availability on create', async () => {
            const resource = makeResource({ highAvailability: 'ZoneRedundant' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--high-availability', 'ZoneRedundant')).toBe(true);
        });

        it('includes --tags on create', async () => {
            const resource = makeResource({ tags: { env: 'staging', merlin: 'true' } });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
            expect(cmd.args).toContain('merlin=true');
        });
    });

    describe('renderUpdate', () => {
        beforeEach(() => mockExists());

        it('emits az postgres flexible-server update', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findUpdate(commands);
            expect(cmd).toBeDefined();
            expect(cmd!.args.slice(0, 3)).toEqual(['postgres', 'flexible-server', 'update']);
        });

        it('does not include create-only flags on update', async () => {
            const resource = makeResource({
                location: 'koreacentral',
                version: '16',
                publicAccess: 'Enabled',
            });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(cmd.args).not.toContain('--location');
            expect(cmd.args).not.toContain('--version');
            expect(cmd.args).not.toContain('--public-access');
        });

        it('does not include --yes on update', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(cmd.args).not.toContain('--yes');
        });

        it('includes --sku-name on update', async () => {
            const resource = makeResource({ skuName: 'Standard_D4ds_v4' });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(hasParam(cmd.args, '--sku-name', 'Standard_D4ds_v4')).toBe(true);
        });

        it('includes --storage-size on update (can only grow)', async () => {
            const resource = makeResource({ storageSizeGb: 64 });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(hasParam(cmd.args, '--storage-size', '64')).toBe(true);
        });

        it('includes --tags on update', async () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const commands = await render.render(resource);
            const cmd = findUpdate(commands)!;
            expect(cmd.args).toContain('--tags');
        });
    });

    describe('getDeployedProps', () => {
        it('returns undefined for exit code 1 (not found)', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('not found');
                err.status = 1;
                throw err;
            });
            const resource = makeResource();
            const commands = await render.render(resource);
            expect(findCreate(commands)).toBeDefined();
        });

        it('throws on unexpected errors', async () => {
            let callCount = 0;
            mockExecAsync.mockImplementation(async () => {
                callCount++;
                if (callCount <= 1) {
                    return JSON.stringify({ name: 'merlin-rg-stg-krc' });
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
        await expect(render.render(resource)).rejects.toThrow('not an AzurePostgreSQLFlexible resource');
    });
});
