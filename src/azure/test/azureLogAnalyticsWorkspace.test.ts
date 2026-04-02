import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureLogAnalyticsWorkspaceRender,
    AzureLogAnalyticsWorkspaceResource,
    AzureLogAnalyticsWorkspaceConfig,
    AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE,
} from '../azureLogAnalyticsWorkspace.js';

// Mock execAsync so it is replaceable in tests
vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, execAsync: vi.fn() };
});

import { execAsync } from '../../common/constants.js';
const mockExecAsync = vi.mocked(execAsync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureLogAnalyticsWorkspaceConfig> = {},
    overrides: Partial<Omit<AzureLogAnalyticsWorkspaceResource, 'config'>> = {}
): AzureLogAnalyticsWorkspaceResource {
    return {
        name: 'mylaw',
        type: AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE,
        ring: 'staging',
        region: 'eastus',
        project: 'myproject',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        resourceGroup: 'myproject-rg-stg-eus',
        config: {
            sku: 'PerGB2018',
            ...config,
        },
        ...overrides,
    } as AzureLogAnalyticsWorkspaceResource;
}

/** Check if a flag + value pair is present in args */
function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

// Default mock: always throw "not found" (resource doesn't exist)
function mockNotFound(): void {
    mockExecAsync.mockImplementation(async () => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

// Mock: RG exists, resource exists with given JSON
function mockResourceExists(showJson: string): void {
    mockExecAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('group') && args.includes('show')) {
            return JSON.stringify({ name: 'myproject-rg-stg-eus' });
        }
        return showJson;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureLogAnalyticsWorkspaceRender', () => {
    let render: AzureLogAnalyticsWorkspaceRender;

    beforeEach(() => {
        render = new AzureLogAnalyticsWorkspaceRender();
        vi.resetAllMocks();
    });

    // ── Metadata ──────────────────────────────────────────────────────────

    describe('getShortResourceTypeName()', () => {
        it('returns "law"', () => {
            expect(render.getShortResourceTypeName()).toBe('law');
        });
    });

    describe('supportConnectorInResourceName', () => {
        it('is true (workspace names support hyphens)', () => {
            expect(render.supportConnectorInResourceName).toBe(true);
        });
    });

    // ── renderCreate ──────────────────────────────────────────────────────

    describe('renderCreate()', () => {
        it('uses the correct subcommand chain', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(args.slice(0, 4)).toEqual(['monitor', 'log-analytics', 'workspace', 'create']);
        });

        it('includes --name with the Merlin-generated resource name', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-mylaw-stg-eus-law')).toBe(true);
        });

        it('includes --resource-group', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        it('includes --sku on create', () => {
            const resource = makeResource({ sku: 'PerGB2018' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--sku', 'PerGB2018')).toBe(true);
        });

        it('includes alternate --sku value CapacityReservation', () => {
            const resource = makeResource({ sku: 'CapacityReservation' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--sku', 'CapacityReservation')).toBe(true);
        });

        it('includes --location', () => {
            const resource = makeResource({ location: 'eastus' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--location', 'eastus')).toBe(true);
        });

        it('includes --retention-time', () => {
            const resource = makeResource({ retentionInDays: 30 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--retention-time', '30')).toBe(true);
        });

        it('includes --quota', () => {
            const resource = makeResource({ dailyQuotaGb: 5 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--quota', '5')).toBe(true);
        });

        it('includes --quota -1 for unlimited quota', () => {
            const resource = makeResource({ dailyQuotaGb: -1 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--quota', '-1')).toBe(true);
        });

        it('includes --capacity-reservation-level', () => {
            const resource = makeResource({ capacityReservationLevel: 500 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--capacity-reservation-level', '500')).toBe(true);
        });

        it('includes --ingestion-access Disabled', () => {
            const resource = makeResource({ ingestionAccess: 'Disabled' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--ingestion-access', 'Disabled')).toBe(true);
        });

        it('includes --query-access Disabled', () => {
            const resource = makeResource({ queryAccess: 'Disabled' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--query-access', 'Disabled')).toBe(true);
        });

        it('includes --replication-enabled true', () => {
            const resource = makeResource({ replicationEnabled: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--replication-enabled', 'true')).toBe(true);
        });

        it('includes --replication-enabled false', () => {
            const resource = makeResource({ replicationEnabled: false });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--replication-enabled', 'false')).toBe(true);
        });

        it('includes --replication-location', () => {
            const resource = makeResource({ replicationLocation: 'westus' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--replication-location', 'westus')).toBe(true);
        });

        it('includes --identity-type SystemAssigned', () => {
            const resource = makeResource({ identityType: 'SystemAssigned' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--identity-type', 'SystemAssigned')).toBe(true);
        });

        it('includes --identity-type UserAssigned', () => {
            const resource = makeResource({ identityType: 'UserAssigned' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--identity-type', 'UserAssigned')).toBe(true);
        });

        it('includes --user-assigned with space-joined identity IDs', () => {
            const ids = [
                '/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id1',
                '/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id2',
            ];
            const resource = makeResource({ identityType: 'UserAssigned', userAssignedIdentities: ids });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--user-assigned');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).toBe(ids.join(' '));
        });

        it('appends --no-wait (presence-only) when noWait is true', () => {
            const resource = makeResource({ noWait: true });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--no-wait');
            expect(idx).not.toBe(-1);
            // Presence-only: no following 'true' or 'false'
            expect(args[idx + 1]).not.toBe('true');
            expect(args[idx + 1]).not.toBe('false');
        });

        it('does not include --no-wait when noWait is false', () => {
            const resource = makeResource({ noWait: false });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('does not include --no-wait when noWait is undefined', () => {
            const resource = makeResource({ noWait: undefined });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('includes --tags', () => {
            const resource = makeResource({ tags: { env: 'staging', team: 'infra' } });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--tags')).toBe(true);
            // Each tag is its own args element so execa() passes them as separate
            // subprocess arguments to Azure CLI.
            expect(args).toContain('env=staging');
            expect(args).toContain('team=infra');
        });

        it('does not include --tags when undefined', () => {
            const resource = makeResource({ tags: undefined });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--tags')).toBe(false);
        });

        it('returns exactly one Command object', () => {
            const resource = makeResource();
            const commands = render.renderCreate(resource);
            expect(commands).toHaveLength(1);
            expect(commands[0].command).toBe('az');
        });
    });

    // ── renderUpdate ──────────────────────────────────────────────────────

    describe('renderUpdate()', () => {
        it('uses the correct subcommand chain', () => {
            const resource = makeResource();
            const args = render.renderUpdate(resource)[0].args;
            expect(args.slice(0, 4)).toEqual(['monitor', 'log-analytics', 'workspace', 'update']);
        });

        it('includes --name and --resource-group', () => {
            const resource = makeResource();
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-mylaw-stg-eus-law')).toBe(true);
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        it('excludes --sku (create-only, immutable after creation)', () => {
            const resource = makeResource({ sku: 'Premium' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--sku')).toBe(false);
        });

        it('includes --retention-time on update', () => {
            const resource = makeResource({ retentionInDays: 90 });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--retention-time', '90')).toBe(true);
        });

        it('includes --quota on update', () => {
            const resource = makeResource({ dailyQuotaGb: 10 });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--quota', '10')).toBe(true);
        });

        it('includes --ingestion-access on update', () => {
            const resource = makeResource({ ingestionAccess: 'Enabled' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--ingestion-access', 'Enabled')).toBe(true);
        });

        it('includes --query-access on update', () => {
            const resource = makeResource({ queryAccess: 'Enabled' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--query-access', 'Enabled')).toBe(true);
        });

        it('includes --replication-enabled on update', () => {
            const resource = makeResource({ replicationEnabled: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--replication-enabled', 'true')).toBe(true);
        });

        it('includes --replication-location on update', () => {
            const resource = makeResource({ replicationLocation: 'eastasia' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--replication-location', 'eastasia')).toBe(true);
        });

        it('includes --identity-type on update', () => {
            const resource = makeResource({ identityType: 'SystemAssigned' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--identity-type', 'SystemAssigned')).toBe(true);
        });

        it('includes --user-assigned on update', () => {
            const ids = ['/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id1'];
            const resource = makeResource({ identityType: 'UserAssigned', userAssignedIdentities: ids });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--user-assigned', ids[0])).toBe(true);
        });

        it('appends --no-wait on update when noWait is true', () => {
            const resource = makeResource({ noWait: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(true);
        });

        it('does not include --no-wait on update when noWait is false', () => {
            const resource = makeResource({ noWait: false });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('includes --tags on update', () => {
            const resource = makeResource({ tags: { env: 'production' } });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--tags', 'env=production')).toBe(true);
        });

        it('returns exactly one Command object', () => {
            const resource = makeResource();
            const commands = render.renderUpdate(resource);
            expect(commands).toHaveLength(1);
            expect(commands[0].command).toBe('az');
        });
    });

    // ── getDeployedProps ──────────────────────────────────────────────────

    describe('getDeployedProps()', () => {
        it('returns undefined when exit code is 3 (resource not found)', async () => {
            mockNotFound();
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('returns undefined when exit code is 1', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('error');
                err.status = 1;
                throw err;
            });
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('returns undefined on ResourceNotFound in error message', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('ResourceNotFound');
                err.status = 2;
                throw err;
            });
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('returns undefined on ResourceGroupNotFound in error message', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('ResourceGroupNotFound');
                err.status = 2;
                throw err;
            });
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('returns undefined on "was not found" in error message', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('The workspace was not found');
                err.status = 2;
                throw err;
            });
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('returns undefined on "could not be found" in error message', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('Resource could not be found');
                err.status = 2;
                throw err;
            });
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result).toBeUndefined();
        });

        it('throws on a genuine error', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('Internal server error');
                err.status = 500;
                throw err;
            });
            await expect((render as any).getDeployedProps(makeResource())).rejects.toThrow(
                /log analytics workspace.*myproject-mylaw-stg-eus-law/i
            );
        });

        it('parses a complete workspace show response correctly', async () => {
            const showJson = JSON.stringify({
                sku: { name: 'PerGB2018', capacityReservationLevel: null },
                location: 'eastus',
                properties: {
                    retentionInDays: 30,
                    workspaceCapping: { dailyQuotaGb: -1.0 },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: false, location: null },
                },
                identity: { type: 'SystemAssigned', userAssignedIdentities: null },
                tags: { env: 'staging' },
            });
            mockExecAsync.mockResolvedValue(showJson);
            const result = await (render as any).getDeployedProps(makeResource());

            expect(result).toBeDefined();
            expect(result.sku).toBe('PerGB2018');
            expect(result.location).toBe('eastus');
            expect(result.retentionInDays).toBe(30);
            expect(result.dailyQuotaGb).toBe(-1.0);
            expect(result.ingestionAccess).toBe('Enabled');
            expect(result.queryAccess).toBe('Enabled');
            expect(result.replicationEnabled).toBe(false);
            expect(result.identityType).toBe('SystemAssigned');
            expect(result.tags).toEqual({ env: 'staging' });

            // Null values should be filtered out
            expect(result.capacityReservationLevel).toBeUndefined();
            expect(result.replicationLocation).toBeUndefined();
            expect(result.userAssignedIdentities).toBeUndefined();
        });

        it('parses capacityReservationLevel when set', async () => {
            const showJson = JSON.stringify({
                sku: { name: 'CapacityReservation', capacityReservationLevel: 500 },
                location: 'eastus',
                properties: {
                    retentionInDays: 30,
                    workspaceCapping: { dailyQuotaGb: -1 },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: false, location: null },
                },
                identity: null,
                tags: {},
            });
            mockExecAsync.mockResolvedValue(showJson);
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result.capacityReservationLevel).toBe(500);
        });

        it('parses replicationLocation when set', async () => {
            const showJson = JSON.stringify({
                sku: { name: 'PerGB2018', capacityReservationLevel: null },
                location: 'eastus',
                properties: {
                    retentionInDays: 30,
                    workspaceCapping: { dailyQuotaGb: -1 },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: true, location: 'westus' },
                },
                identity: null,
                tags: {},
            });
            mockExecAsync.mockResolvedValue(showJson);
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result.replicationEnabled).toBe(true);
            expect(result.replicationLocation).toBe('westus');
        });

        it('parses user-assigned identity IDs', async () => {
            const id1 = '/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id1';
            const id2 = '/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id2';
            const showJson = JSON.stringify({
                sku: { name: 'PerGB2018', capacityReservationLevel: null },
                location: 'eastus',
                properties: {
                    retentionInDays: 30,
                    workspaceCapping: { dailyQuotaGb: -1 },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: false, location: null },
                },
                identity: {
                    type: 'UserAssigned',
                    userAssignedIdentities: {
                        [id1]: { clientId: 'c1', principalId: 'p1' },
                        [id2]: { clientId: 'c2', principalId: 'p2' },
                    },
                },
                tags: {},
            });
            mockExecAsync.mockResolvedValue(showJson);
            const result = await (render as any).getDeployedProps(makeResource());
            expect(result.identityType).toBe('UserAssigned');
            expect(result.userAssignedIdentities).toEqual([id1, id2]);
        });

        it('omits undefined values from returned config', async () => {
            const showJson = JSON.stringify({
                sku: { name: 'PerGB2018', capacityReservationLevel: null },
                location: 'eastus',
                properties: {
                    retentionInDays: undefined,
                    workspaceCapping: { dailyQuotaGb: undefined },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: false, location: null },
                },
                identity: null,
                tags: undefined,
            });
            mockExecAsync.mockResolvedValue(showJson);
            const result = await (render as any).getDeployedProps(makeResource());
            // No key should have undefined or null as value
            for (const val of Object.values(result)) {
                expect(val).not.toBeUndefined();
                expect(val).not.toBeNull();
            }
        });
    });

    // ── renderImpl dispatch ───────────────────────────────────────────────

    describe('renderImpl() dispatch', () => {
        it('throws when resource type does not match', async () => {
            const resource = makeResource({}, { type: 'WrongType' } as any);
            await expect(render.renderImpl(resource)).rejects.toThrow(
                /not an Azure Log Analytics Workspace resource/
            );
        });

        it('routes to create when resource does not exist', async () => {
            mockNotFound();
            const resource = makeResource();
            const commands = await render.renderImpl(resource);
            const subcommands = commands.flatMap(c => c.args);
            expect(subcommands).toContain('create');
            expect(subcommands).not.toContain('update');
        });

        it('routes to update when resource exists', async () => {
            const showJson = JSON.stringify({
                sku: { name: 'PerGB2018', capacityReservationLevel: null },
                location: 'eastus',
                properties: {
                    retentionInDays: 30,
                    workspaceCapping: { dailyQuotaGb: -1 },
                    publicNetworkAccessForIngestion: 'Enabled',
                    publicNetworkAccessForQuery: 'Enabled',
                    replication: { enabled: false, location: null },
                },
                identity: null,
                tags: {},
            });
            mockResourceExists(showJson);
            const resource = makeResource();
            const commands = await render.renderImpl(resource);
            const subcommands = commands.flatMap(c => c.args);
            expect(subcommands).toContain('update');
            expect(subcommands).not.toContain('create');
        });
    });
});
