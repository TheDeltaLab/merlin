import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureDnsZoneRender,
    AzureDnsZoneResource,
    AzureDnsZoneConfig,
    AZURE_DNS_ZONE_RESOURCE_TYPE,
} from '../azureDnsZone.js';

// Mock child_process so execSync is replaceable in tests
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureDnsZoneConfig> = {},
    overrides: Partial<Omit<AzureDnsZoneResource, 'config'>> = {}
): AzureDnsZoneResource {
    return {
        name: 'mydns',
        type: AZURE_DNS_ZONE_RESOURCE_TYPE,
        ring: 'staging',
        project: 'merlintest',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            dnsName: 'mydns',
            parentName: 'example.com',
            resourceGroupRegion: 'eastasia',
            ...config,
        },
        ...overrides,
    } as AzureDnsZoneResource;
}

/** Check if a flag + value pair is present in args */
function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

/** Mock: all az calls throw "not found" — use for tests that don't reach the list check */
function mockNotFound(): void {
    mockExecSync.mockImplementation(() => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

/**
 * Mock: parent zone exists in list, but the child zone and RG do not.
 * Use for renderImpl happy-path "create" tests where parentName is set.
 */
function mockNotFoundWithParentPresent(): void {
    mockExecSync.mockImplementation((cmd: string) => {
        const c = String(cmd);
        if (c.includes('dns zone list')) {
            return JSON.stringify([{ name: 'example.com' }]) as any;
        }
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

/** Mock: zone exists, with optional tags */
function mockZoneExists(tags?: Record<string, string>): void {
    mockExecSync.mockImplementation((cmd: string) => {
        const c = String(cmd);
        if (c.includes('group show')) {
            return JSON.stringify({ name: 'merlintest-rg-stg' }) as any;
        }
        if (c.includes('dns zone list')) {
            return JSON.stringify([{ name: 'example.com' }]) as any;
        }
        return JSON.stringify({ name: 'mydns.example.com', tags: tags ?? {} }) as any;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureDnsZoneRender', () => {
    let render: AzureDnsZoneRender;

    beforeEach(() => {
        render = new AzureDnsZoneRender();
        vi.resetAllMocks();
    });

    // ── 1. Basic metadata ────────────────────────────────────────────────────

    describe('getShortResourceTypeName', () => {
        it('returns dnsz', () => {
            expect(render.getShortResourceTypeName()).toBe('dnsz');
        });
    });

    describe('supportConnectorInResourceName', () => {
        it('is true (hyphens supported)', () => {
            expect(render.supportConnectorInResourceName).toBe(true);
        });
    });

    // ── 2. DNS zone name (actual Azure name) ─────────────────────────────────

    describe('getDnsZoneName', () => {
        it('combines dnsName + parentName with a dot', () => {
            const resource = makeResource({ dnsName: 'chuangdns', parentName: 'thebrainly.dev' });
            expect(render.getDnsZoneName(resource)).toBe('chuangdns.thebrainly.dev');
        });

        it('returns dnsName alone when parentName is not set', () => {
            const resource = makeResource({ dnsName: 'standalone.example.com', parentName: undefined });
            expect(render.getDnsZoneName(resource)).toBe('standalone.example.com');
        });
    });

    // ── 3. Merlin-internal resource naming ───────────────────────────────────

    describe('getResourceName', () => {
        it('uses project + name + ring + type abbreviation (no region)', () => {
            const resource = makeResource();
            expect(render.getResourceName(resource)).toBe('merlintest-mydns-stg-dnsz');
        });

        it('uses "shared" prefix when no project is set', () => {
            const resource = makeResource({}, { project: undefined });
            expect(render.getResourceName(resource)).toBe('shared-mydns-stg-dnsz');
        });

        it('abbreviates ring: test → tst', () => {
            const resource = makeResource({}, { ring: 'test' });
            expect(render.getResourceName(resource)).toBe('merlintest-mydns-tst-dnsz');
        });

        it('abbreviates ring: production → prd', () => {
            const resource = makeResource({}, { ring: 'production' });
            expect(render.getResourceName(resource)).toBe('merlintest-mydns-prd-dnsz');
        });

        it('ignores region even if one is set', () => {
            const resource = makeResource({}, { region: 'eastasia' } as any);
            expect(render.getResourceName(resource)).toBe('merlintest-mydns-stg-dnsz');
        });
    });

    describe('getResourceGroupName', () => {
        it('uses project + rg + ring abbreviation (no region)', () => {
            const resource = makeResource();
            expect(render.getResourceGroupName(resource)).toBe('merlintest-rg-stg');
        });
    });

    // ── 4. renderCreate ──────────────────────────────────────────────────────

    describe('renderCreate', () => {
        it('uses az network dns zone create subcommand', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args.slice(0, 4)).toEqual(['network', 'dns', 'zone', 'create']);
        });

        it('passes the DNS zone name (dnsName.parentName) as --name', () => {
            const resource = makeResource({ dnsName: 'chuangdns', parentName: 'thebrainly.dev' });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--name', 'chuangdns.thebrainly.dev')).toBe(true);
        });

        it('passes only dnsName as --name when parentName is absent', () => {
            const resource = makeResource({ dnsName: 'standalone.example.com', parentName: undefined });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--name', 'standalone.example.com')).toBe(true);
        });

        it('includes --resource-group', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--resource-group', 'merlintest-rg-stg')).toBe(true);
        });

        it('does NOT include --parent-name (parentName is folded into --name)', () => {
            const resource = makeResource({ parentName: 'example.com' });
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).not.toContain('--parent-name');
        });

        it('includes --tags when set', () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).toContain('--tags');
            const tagsIdx = cmd.args.indexOf('--tags');
            expect(cmd.args[tagsIdx + 1]).toBe('env=staging');
        });

        it('omits --tags when not set', () => {
            const resource = makeResource({ tags: undefined });
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).not.toContain('--tags');
        });

        it('returns exactly one command', () => {
            const resource = makeResource();
            expect(render.renderCreate(resource)).toHaveLength(1);
        });
    });

    // ── 5. renderUpdate ──────────────────────────────────────────────────────

    describe('renderUpdate', () => {
        it('uses az network dns zone update subcommand', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args.slice(0, 4)).toEqual(['network', 'dns', 'zone', 'update']);
        });

        it('passes the DNS zone name as --name', () => {
            const resource = makeResource({ dnsName: 'chuangdns', parentName: 'thebrainly.dev' });
            const [cmd] = render.renderUpdate(resource);
            expect(hasParam(cmd.args, '--name', 'chuangdns.thebrainly.dev')).toBe(true);
        });

        it('includes --resource-group', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource);
            expect(hasParam(cmd.args, '--resource-group', 'merlintest-rg-stg')).toBe(true);
        });

        it('includes --tags when set', () => {
            const resource = makeResource({ tags: { env: 'production' } });
            const [cmd] = render.renderUpdate(resource);
            expect(cmd.args).toContain('--tags');
            const tagsIdx = cmd.args.indexOf('--tags');
            expect(cmd.args[tagsIdx + 1]).toBe('env=production');
        });

        it('does NOT include --parent-name', () => {
            const resource = makeResource({ parentName: 'example.com' });
            const [cmd] = render.renderUpdate(resource);
            expect(cmd.args).not.toContain('--parent-name');
        });

        it('returns exactly one command', () => {
            const resource = makeResource();
            expect(render.renderUpdate(resource)).toHaveLength(1);
        });
    });

    // ── 6. renderImpl dispatch ───────────────────────────────────────────────

    describe('renderImpl via render()', () => {
        it('calls renderCreate when zone does not exist (exit code 3)', async () => {
            mockNotFoundWithParentPresent();
            const resource = makeResource();
            const cmds = await render.render(resource);
            const dnsCmd = cmds.find(c => c.args.includes('create'));
            expect(dnsCmd).toBeDefined();
            expect(dnsCmd!.args).not.toContain('update');
        });

        it('calls renderUpdate when zone already exists', async () => {
            mockZoneExists({ env: 'staging' });
            const resource = makeResource();
            const cmds = await render.render(resource);
            const dnsCmd = cmds.find(c => c.args.includes('update'));
            expect(dnsCmd).toBeDefined();
            expect(dnsCmd!.args).not.toContain('create');
        });

        it('throws when resource type is wrong', async () => {
            mockNotFound();
            const resource = makeResource({}, { type: 'SomeOtherType' });
            await expect(render.render(resource)).rejects.toThrow('is not an Azure DNS Zone resource');
        });

        it('propagates unexpected errors from resource group check', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                const c = String(cmd);
                if (c.includes('dns zone list')) {
                    return JSON.stringify([{ name: 'example.com' }]) as any;
                }
                const err: any = new Error('Network failure');
                err.status = 255;
                throw err;
            });
            const resource = makeResource();
            await expect(render.render(resource)).rejects.toThrow('Failed to check resource group');
        });

        it('propagates unexpected errors from getDeployedProps', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                const c = String(cmd);
                if (c.includes('dns zone list')) {
                    return JSON.stringify([{ name: 'example.com' }]) as any;
                }
                if (c.includes('group show')) {
                    // RG exists — let RG check pass
                    return JSON.stringify({ name: 'merlintest-rg-stg' }) as any;
                }
                // DNS zone show fails unexpectedly
                const err: any = new Error('Network failure');
                err.status = 255;
                throw err;
            });
            const resource = makeResource();
            await expect(render.render(resource)).rejects.toThrow('Failed to get deployed properties');
        });
    });

    // ── 7. Parent DNS zone existence check ──────────────────────────────────

    describe('parent DNS zone existence check', () => {
        it('skips check when parentName is undefined (root zone)', async () => {
            // Use a mock that succeeds for all az calls so the render completes
            mockExecSync.mockImplementation((cmd: string) => {
                const c = String(cmd);
                // dns zone list should never be called for root zones
                if (c.includes('dns zone list')) throw new Error('dns zone list should not be called');
                if (c.includes('group show')) return JSON.stringify({ name: 'merlintest-rg-stg' }) as any;
                // dns zone show — zone doesn't exist
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: undefined });
            // Should succeed and NOT call dns zone list
            const cmds = await render.render(resource);
            expect(cmds.some(c => c.args.includes('create'))).toBe(true);
            const calls = mockExecSync.mock.calls.map(c => String(c[0]));
            expect(calls.some(c => c.includes('dns zone list'))).toBe(false);
        });

        it('proceeds normally when parent zone is found in the list', async () => {
            mockNotFoundWithParentPresent();
            const resource = makeResource({ parentName: 'example.com' });
            const cmds = await render.render(resource);
            const dnsCmd = cmds.find(c => c.args.includes('create'));
            expect(dnsCmd).toBeDefined();
        });

        it('throws when parent zone is not in the list (empty list)', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) {
                    return JSON.stringify([]) as any;
                }
                const err: any = new Error('ResourceNotFound');
                err.status = 3;
                throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow('does not exist in Azure');
        });

        it('error message includes the missing parent zone name', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) return JSON.stringify([]) as any;
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow("'example.com'");
        });

        it('error message includes the manual az create command', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) return JSON.stringify([]) as any;
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow(
                'az network dns zone create --name example.com'
            );
        });

        it('throws when az network dns zone list itself fails', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) {
                    const err: any = new Error('auth error');
                    err.status = 1;
                    err.stderr = Buffer.from('AADSTS error');
                    throw err;
                }
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow('Failed to list DNS zones');
        });

        it('throws when az network dns zone list returns non-JSON output', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) return 'WARNING: not json garbage' as any;
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow('Failed to parse DNS zone list');
        });

        it('matches parent zone name case-insensitively (list has uppercase)', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                const c = String(cmd);
                if (c.includes('dns zone list')) return JSON.stringify([{ name: 'EXAMPLE.COM' }]) as any;
                if (c.includes('group show')) return JSON.stringify({ name: 'merlintest-rg-stg' }) as any;
                // dns zone show — zone doesn't exist
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            // Should NOT throw — parent found case-insensitively, render proceeds to create
            const cmds = await render.render(resource);
            expect(cmds.some(c => c.args.includes('create'))).toBe(true);
        });

        it('does not match a similar but non-equal name (sub.example.com ≠ example.com)', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('dns zone list')) {
                    return JSON.stringify([{ name: 'sub.example.com' }]) as any;
                }
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            await expect(render.render(resource)).rejects.toThrow('does not exist in Azure');
        });

        it('finds the parent when multiple zones are in the list', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                const c = String(cmd);
                if (c.includes('dns zone list')) {
                    return JSON.stringify([
                        { name: 'other.dev' },
                        { name: 'example.com' },
                        { name: 'another.net' },
                    ]) as any;
                }
                if (c.includes('group show')) return JSON.stringify({ name: 'merlintest-rg-stg' }) as any;
                // dns zone show — zone doesn't exist
                const err: any = new Error('ResourceNotFound'); err.status = 3; throw err;
            });
            const resource = makeResource({ parentName: 'example.com' });
            // Parent found — render proceeds to create
            const cmds = await render.render(resource);
            expect(cmds.some(c => c.args.includes('create'))).toBe(true);
        });
    });
});
