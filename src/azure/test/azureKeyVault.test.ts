import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureKeyVaultRender,
    AzureKeyVaultResource,
    AzureKeyVaultConfig,
    AZURE_KEY_VAULT_RESOURCE_TYPE,
} from '../azureKeyVault.js';

// Mock child_process so execSync is replaceable in tests
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureKeyVaultConfig> = {},
    overrides: Partial<Omit<AzureKeyVaultResource, 'config'>> = {}
): AzureKeyVaultResource {
    return {
        name: 'shared',
        type: AZURE_KEY_VAULT_RESOURCE_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        project: 'merlin',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            sku: 'standard',
            enableRbacAuthorization: true,
            ...config,
        },
        ...overrides,
    } as AzureKeyVaultResource;
}

function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

function findKvCreate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'keyvault' && c.args[1] === 'create');
}

function findKvUpdate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'keyvault' && c.args[1] === 'update');
}

function mockNotFound(): void {
    mockExecSync.mockImplementation(() => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

function mockKeyVaultExists(props: object = {}): void {
    mockExecSync.mockImplementation((cmd: string) => {
        const c = String(cmd);
        if (c.includes('group show')) {
            return JSON.stringify({ name: 'merlin-rg-stg-krc' }) as any;
        }
        // keyvault show
        return JSON.stringify({
            properties: {
                sku: { name: 'standard' },
                enableRbacAuthorization: true,
                enableSoftDelete: true,
                softDeleteRetentionDays: 90,
                enablePurgeProtection: true,
            },
            tags: {},
            ...props,
        }) as any;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureKeyVaultRender', () => {
    let render: AzureKeyVaultRender;

    beforeEach(() => {
        render = new AzureKeyVaultRender();
        vi.resetAllMocks();
    });

    // ── Metadata ──────────────────────────────────────────────────────────────

    it('getShortResourceTypeName returns akv', () => {
        expect(render.getShortResourceTypeName()).toBe('akv');
    });

    it('supportConnectorInResourceName is false', () => {
        expect(render.supportConnectorInResourceName).toBe(false);
    });

    it('derives correct resource name (no connector)', () => {
        const resource = makeResource();
        // supportConnectorInResourceName=false → no hyphens
        expect(render.getResourceName(resource)).toBe('merlinsharedstgkrcakv');
    });

    // ── renderCreate ──────────────────────────────────────────────────────────

    describe('renderCreate', () => {
        beforeEach(() => mockNotFound());

        it('emits az keyvault create with required flags', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands);
            expect(cmd).toBeDefined();
            expect(hasParam(cmd!.args, '--name', 'merlinsharedstgkrcakv')).toBe(true);
            expect(hasParam(cmd!.args, '--resource-group', 'merlin-rg-stg-krc')).toBe(true);
        });

        it('includes --sku on create', async () => {
            const resource = makeResource({ sku: 'premium' });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(hasParam(cmd.args, '--sku', 'premium')).toBe(true);
        });

        it('includes --enable-rbac-authorization when set', async () => {
            const resource = makeResource({ enableRbacAuthorization: true });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(cmd.args).toContain('--enable-rbac-authorization');
        });

        it('includes --location on create', async () => {
            const resource = makeResource({ location: 'koreacentral' });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(hasParam(cmd.args, '--location', 'koreacentral')).toBe(true);
        });

        it('includes --retention-days on create', async () => {
            const resource = makeResource({ softDeleteRetentionInDays: 90 });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(hasParam(cmd.args, '--retention-days', '90')).toBe(true);
        });

        it('does not include --enable-soft-delete (removed in CLI 2.50+)', async () => {
            const resource = makeResource({ enableSoftDelete: true });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(cmd.args).not.toContain('--enable-soft-delete');
        });

        it('includes --enable-purge-protection on create', async () => {
            const resource = makeResource({ enablePurgeProtection: true });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(cmd.args).toContain('--enable-purge-protection');
        });

        it('includes --tags when set', async () => {
            const resource = makeResource({ tags: { env: 'staging', managed: 'merlin' } });
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
            expect(cmd.args).toContain('managed=merlin');
        });
    });

    // ── renderUpdate ──────────────────────────────────────────────────────────

    describe('renderUpdate', () => {
        beforeEach(() => mockKeyVaultExists());

        it('emits az keyvault update when vault already exists', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands);
            expect(cmd).toBeDefined();
            expect(cmd!.args[0]).toBe('keyvault');
            expect(cmd!.args[1]).toBe('update');
        });

        it('does not include create-only flags on update (location, retention-days, enable-soft-delete)', async () => {
            const resource = makeResource({
                location: 'koreacentral',
                softDeleteRetentionInDays: 90,
                enableSoftDelete: true,
            });
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands)!;
            expect(cmd.args).not.toContain('--location');
            expect(cmd.args).not.toContain('--retention-days');
            expect(cmd.args).not.toContain('--enable-soft-delete');
        });

        it('does not include --sku on update (create-only)', async () => {
            const resource = makeResource({ sku: 'premium' });
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands)!;
            expect(cmd.args).not.toContain('--sku');
        });

        it('includes --enable-rbac-authorization on update', async () => {
            const resource = makeResource({ enableRbacAuthorization: true });
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands)!;
            expect(cmd.args).toContain('--enable-rbac-authorization');
        });

        it('includes --enable-purge-protection on update', async () => {
            const resource = makeResource({ enablePurgeProtection: true });
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands)!;
            expect(cmd.args).toContain('--enable-purge-protection');
        });

        it('does not include --tags on update (not supported)', async () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const commands = await render.render(resource);
            const cmd = findKvUpdate(commands)!;
            expect(cmd.args).not.toContain('--tags');
        });
    });

    // ── getDeployedProps error handling ────────────────────────────────────────

    describe('getDeployedProps', () => {
        it('returns undefined for VaultNotFound error', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('VaultNotFound: vault was not found');
                err.status = 0;
                throw err;
            });
            const resource = makeResource();
            // On VaultNotFound → renderCreate path
            const commands = await render.render(resource);
            const cmd = findKvCreate(commands);
            expect(cmd).toBeDefined();
        });

        it('throws on unexpected errors', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('NetworkError: something went wrong');
                err.status = 99;
                throw err;
            });
            const resource = makeResource();
            await expect(render.render(resource)).rejects.toThrow('Failed to get deployed properties');
        });
    });

    // ── Type check ────────────────────────────────────────────────────────────

    it('throws for wrong resource type', async () => {
        mockNotFound();
        const resource = makeResource({}, { type: 'WrongType' } as any);
        await expect(render.render(resource)).rejects.toThrow('not an AzureKeyVault resource');
    });
});
