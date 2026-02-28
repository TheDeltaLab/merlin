import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureContainerAppEnvironmentRender,
    AzureContainerAppEnvironmentResource,
    AzureContainerAppEnvironmentConfig,
    AZURE_CONTAINER_APP_ENVIRONMENT_TYPE,
} from '../azureContainerAppEnvironment.js';
import { Resource } from '../../common/resource.js';

// Mock child_process so execSync is replaceable in tests
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureContainerAppEnvironmentConfig> = {},
    overrides: Partial<Omit<AzureContainerAppEnvironmentResource, 'config'>> = {}
): AzureContainerAppEnvironmentResource {
    return {
        name: 'myenv',
        type: AZURE_CONTAINER_APP_ENVIRONMENT_TYPE,
        ring: 'staging',
        region: 'eastus',
        project: 'myproject',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        resourceGroup: 'myproject-rg-stg-eus',
        config: {
            logsDestination: 'log-analytics',
            ...config,
        },
        ...overrides,
    } as AzureContainerAppEnvironmentResource;
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
    mockExecSync.mockImplementation(() => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

// Mock: RG exists, resource exists with given JSON
function mockResourceExists(showJson: string): void {
    mockExecSync.mockImplementation((cmd: string) => {
        const c = String(cmd);
        if (c.includes('group show')) {
            return JSON.stringify({ name: 'myproject-rg-stg-eus' }) as any;
        }
        return showJson as any;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureContainerAppEnvironmentRender', () => {
    let render: AzureContainerAppEnvironmentRender;

    beforeEach(() => {
        render = new AzureContainerAppEnvironmentRender();
        vi.resetAllMocks();
    });

    // ── 1. Basic metadata ────────────────────────────────────────────────────

    describe('getShortResourceTypeName', () => {
        it('returns acenv', () => {
            expect(render.getShortResourceTypeName()).toBe('acenv');
        });
    });

    describe('supportConnectorInResourceName', () => {
        it('is true (hyphens supported)', () => {
            expect(render.supportConnectorInResourceName).toBe(true);
        });
    });

    // ── 2. Resource naming ───────────────────────────────────────────────────

    describe('getResourceName', () => {
        it('builds correct name with project, ring, region and type suffix', () => {
            const resource = makeResource();
            // project=myproject, name=myenv, ring=staging→stg, region=eastus→eus, type=acenv
            expect(render.getResourceName(resource)).toBe('myproject-myenv-stg-eus-acenv');
        });

        it('uses "shared" when no project is set', () => {
            const resource = makeResource({}, { project: undefined });
            expect(render.getResourceName(resource)).toBe('shared-myenv-stg-eus-acenv');
        });

        it('omits region when not set', () => {
            const resource = makeResource({}, { region: undefined });
            expect(render.getResourceName(resource)).toBe('myproject-myenv-stg-acenv');
        });
    });

    describe('getResourceGroupName', () => {
        it('builds correct resource group name', () => {
            const resource = makeResource();
            expect(render.getResourceGroupName(resource)).toBe('myproject-rg-stg-eus');
        });
    });

    // ── 3. render() dispatch ─────────────────────────────────────────────────

    describe('render()', () => {
        it('throws when resource type does not match', async () => {
            const resource = makeResource({}, { type: 'SomethingElse' } as any);
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'is not an Azure Container App Environment resource'
            );
        });

        it('routes to create when resource does not exist', async () => {
            mockNotFound();
            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 3).join(' '));
            expect(subcommands.some(s => s === 'containerapp env create')).toBe(true);
        });

        it('routes to update when resource exists', async () => {
            const showResponse = JSON.stringify({
                properties: {
                    appLogsConfiguration: { destination: 'log-analytics' },
                    vnetConfiguration: {},
                    peerAuthentication: { mtls: { enabled: false } },
                    peerTrafficConfiguration: { encryption: { enabled: false } },
                },
                tags: {},
            });
            mockResourceExists(showResponse);

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 3).join(' '));
            expect(subcommands.some(s => s === 'containerapp env update')).toBe(true);
        });
    });

    // ── 4. renderCreate ──────────────────────────────────────────────────────

    describe('renderCreate()', () => {
        it('produces az containerapp env create as the base command', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('containerapp');
            expect(cmd.args[1]).toBe('env');
            expect(cmd.args[2]).toBe('create');
        });

        it('includes --name and --resource-group', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-myenv-stg-eus-acenv')).toBe(true);
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        it('includes --logs-destination', () => {
            const resource = makeResource({ logsDestination: 'log-analytics' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--logs-destination', 'log-analytics')).toBe(true);
        });

        it('includes --logs-workspace-id', () => {
            const resource = makeResource({ logsWorkspaceId: 'workspace-123' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--logs-workspace-id', 'workspace-123')).toBe(true);
        });

        it('includes --logs-workspace-key', () => {
            const resource = makeResource({ logsWorkspaceKey: 'key-secret' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--logs-workspace-key', 'key-secret')).toBe(true);
        });

        it('includes --dapr-connection-string', () => {
            const resource = makeResource({ daprConnectionString: 'grpc://dapr:50001' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--dapr-connection-string', 'grpc://dapr:50001')).toBe(true);
        });

        it('includes --storage-account', () => {
            const resource = makeResource({ storageAccount: 'mystorageaccount' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--storage-account', 'mystorageaccount')).toBe(true);
        });

        it('includes --location', () => {
            const resource = makeResource({ location: 'eastus' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--location', 'eastus')).toBe(true);
        });

        // CREATE-ONLY params
        it('includes --infrastructure-subnet-resource-id (create-only)', () => {
            const resource = makeResource({ infrastructureSubnetResourceId: '/subscriptions/abc/subnets/mysubnet' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--infrastructure-subnet-resource-id', '/subscriptions/abc/subnets/mysubnet')).toBe(true);
        });

        it('includes --infrastructure-resource-group (create-only)', () => {
            const resource = makeResource({ infrastructureResourceGroup: 'my-infra-rg' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--infrastructure-resource-group', 'my-infra-rg')).toBe(true);
        });

        it('includes --platform-reserved-cidr (create-only)', () => {
            const resource = makeResource({ platformReservedCidr: '10.0.0.0/16' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--platform-reserved-cidr', '10.0.0.0/16')).toBe(true);
        });

        it('includes --platform-reserved-dns-ip (create-only)', () => {
            const resource = makeResource({ platformReservedDnsIp: '10.0.0.2' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--platform-reserved-dns-ip', '10.0.0.2')).toBe(true);
        });

        it('includes --certificate-file (create-only)', () => {
            const resource = makeResource({ customDomainCertificateFile: '/path/to/cert.pfx' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--certificate-file', '/path/to/cert.pfx')).toBe(true);
        });

        it('includes --certificate-password (create-only)', () => {
            const resource = makeResource({ customDomainCertificatePassword: 'certpassword' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--certificate-password', 'certpassword')).toBe(true);
        });

        it('includes --custom-domain-dns-suffix (create-only)', () => {
            const resource = makeResource({ customDomainDnsSuffix: 'myapp.example.com' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--custom-domain-dns-suffix', 'myapp.example.com')).toBe(true);
        });

        it('includes --enable-mtls true', () => {
            const resource = makeResource({ enableMtls: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--enable-mtls', 'true')).toBe(true);
        });

        it('includes --enable-mtls false', () => {
            const resource = makeResource({ enableMtls: false });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--enable-mtls', 'false')).toBe(true);
        });

        it('includes --enable-peer-to-peer-encryption true', () => {
            const resource = makeResource({ enablePeerToPeerEncryption: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--enable-peer-to-peer-encryption', 'true')).toBe(true);
        });

        it('includes --internal-only true (create-only)', () => {
            const resource = makeResource({ internalOnly: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--internal-only', 'true')).toBe(true);
        });

        it('includes --internal-only false (create-only)', () => {
            const resource = makeResource({ internalOnly: false });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--internal-only', 'false')).toBe(true);
        });

        it('includes --enable-workload-profiles true (create-only)', () => {
            const resource = makeResource({ enableWorkloadProfiles: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--enable-workload-profiles', 'true')).toBe(true);
        });

        it('includes --zone-redundant true (create-only)', () => {
            const resource = makeResource({ zoneRedundant: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--zone-redundant', 'true')).toBe(true);
        });

        it('appends --no-wait (presence-only) when noWait is true', () => {
            const resource = makeResource({ noWait: true });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--no-wait');
            expect(idx).not.toBe(-1);
            // The flag should NOT be followed by 'true' or 'false'
            expect(args[idx + 1]).not.toBe('true');
            expect(args[idx + 1]).not.toBe('false');
        });

        it('does NOT include --no-wait when noWait is false', () => {
            const resource = makeResource({ noWait: false });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('does NOT include --no-wait when noWait is undefined', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('includes --tags', () => {
            const resource = makeResource({ tags: { env: 'staging', owner: 'team' } });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--tags')).toBe(true);
            // Tags are merged into a single space-separated string
            const tagsIdx = args.indexOf('--tags');
            expect(args[tagsIdx + 1]).toBe('env=staging owner=team');
        });

        it('does not include tags when not set', () => {
            const resource = makeResource({ tags: undefined });
            const args = render.renderCreate(resource)[0].args;
            expect(args.includes('--tags')).toBe(false);
        });
    });

    // ── 5. renderUpdate ──────────────────────────────────────────────────────

    describe('renderUpdate()', () => {
        it('produces az containerapp env update as the base command', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('containerapp');
            expect(cmd.args[1]).toBe('env');
            expect(cmd.args[2]).toBe('update');
        });

        it('includes --name and --resource-group', () => {
            const resource = makeResource();
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-myenv-stg-eus-acenv')).toBe(true);
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        it('includes --logs-destination on update', () => {
            const resource = makeResource({ logsDestination: 'azure-monitor' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--logs-destination', 'azure-monitor')).toBe(true);
        });

        it('includes --enable-mtls on update', () => {
            const resource = makeResource({ enableMtls: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--enable-mtls', 'true')).toBe(true);
        });

        it('includes --enable-peer-to-peer-encryption on update', () => {
            const resource = makeResource({ enablePeerToPeerEncryption: false });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--enable-peer-to-peer-encryption', 'false')).toBe(true);
        });

        it('excludes --infrastructure-subnet-resource-id (create-only) on update', () => {
            const resource = makeResource({ infrastructureSubnetResourceId: '/subscriptions/abc/subnets/mysubnet' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--infrastructure-subnet-resource-id')).toBe(false);
        });

        it('excludes --infrastructure-resource-group (create-only) on update', () => {
            const resource = makeResource({ infrastructureResourceGroup: 'my-infra-rg' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--infrastructure-resource-group')).toBe(false);
        });

        it('excludes --platform-reserved-cidr (create-only) on update', () => {
            const resource = makeResource({ platformReservedCidr: '10.0.0.0/16' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--platform-reserved-cidr')).toBe(false);
        });

        it('excludes --platform-reserved-dns-ip (create-only) on update', () => {
            const resource = makeResource({ platformReservedDnsIp: '10.0.0.2' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--platform-reserved-dns-ip')).toBe(false);
        });

        it('excludes --certificate-file (create-only) on update', () => {
            const resource = makeResource({ customDomainCertificateFile: '/path/to/cert.pfx' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--certificate-file')).toBe(false);
        });

        it('excludes --certificate-password (create-only) on update', () => {
            const resource = makeResource({ customDomainCertificatePassword: 'password' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--certificate-password')).toBe(false);
        });

        it('excludes --custom-domain-dns-suffix (create-only) on update', () => {
            const resource = makeResource({ customDomainDnsSuffix: 'myapp.example.com' });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--custom-domain-dns-suffix')).toBe(false);
        });

        it('excludes --internal-only (create-only) on update', () => {
            const resource = makeResource({ internalOnly: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--internal-only')).toBe(false);
        });

        it('excludes --enable-workload-profiles (create-only) on update', () => {
            const resource = makeResource({ enableWorkloadProfiles: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--enable-workload-profiles')).toBe(false);
        });

        it('excludes --zone-redundant (create-only) on update', () => {
            const resource = makeResource({ zoneRedundant: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--zone-redundant')).toBe(false);
        });

        it('appends --no-wait (presence-only) when noWait is true', () => {
            const resource = makeResource({ noWait: true });
            const args = render.renderUpdate(resource)[0].args;
            const idx = args.indexOf('--no-wait');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).not.toBe('true');
            expect(args[idx + 1]).not.toBe('false');
        });

        it('does NOT include --no-wait when noWait is false', () => {
            const resource = makeResource({ noWait: false });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('includes --tags on update', () => {
            const resource = makeResource({ tags: { env: 'staging' } });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--tags')).toBe(true);
            const tagsIdx = args.indexOf('--tags');
            expect(args[tagsIdx + 1]).toBe('env=staging');
        });
    });

    // ── 6. getDeployedProps ──────────────────────────────────────────────────

    describe('getDeployedProps()', () => {
        it('returns undefined when resource is not found (exit code 3)', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('not found');
                err.status = 3;
                throw err;
            });
            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeUndefined();
        });

        it('returns undefined when resource is not found (exit code 1)', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('not found');
                err.status = 1;
                throw err;
            });
            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeUndefined();
        });

        it('returns undefined on ResourceNotFound in error message', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('ResourceNotFound: environment does not exist');
            });
            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeUndefined();
        });

        it('returns undefined on "was not found" in error message', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('The resource was not found');
            });
            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeUndefined();
        });

        it('throws on genuine errors', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('Internal server error');
                err.status = 500;
                throw err;
            });
            const resource = makeResource();
            await expect((render as any).getDeployedProps(resource)).rejects.toThrow(
                'Failed to get deployed properties for container app environment'
            );
        });

        it('parses logs configuration correctly', async () => {
            const showJson = JSON.stringify({
                properties: {
                    appLogsConfiguration: {
                        destination: 'log-analytics',
                        logAnalyticsConfiguration: {
                            customerId: 'workspace-id-123',
                        },
                    },
                    vnetConfiguration: {},
                    peerAuthentication: {},
                    peerTrafficConfiguration: {},
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeDefined();
            expect(result.logsDestination).toBe('log-analytics');
            expect(result.logsWorkspaceId).toBe('workspace-id-123');
        });

        it('parses vnet configuration correctly', async () => {
            const showJson = JSON.stringify({
                properties: {
                    appLogsConfiguration: {},
                    vnetConfiguration: {
                        internal: true,
                        platformReservedCidr: '10.0.0.0/16',
                        platformReservedDnsIP: '10.0.0.2',
                        infrastructureSubnetId: '/subscriptions/abc/subnets/mysubnet',
                    },
                    peerAuthentication: {},
                    peerTrafficConfiguration: {},
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeDefined();
            expect(result.internalOnly).toBe(true);
            expect(result.platformReservedCidr).toBe('10.0.0.0/16');
            expect(result.platformReservedDnsIp).toBe('10.0.0.2');
            expect(result.infrastructureSubnetResourceId).toBe('/subscriptions/abc/subnets/mysubnet');
        });

        it('parses peer authentication correctly', async () => {
            const showJson = JSON.stringify({
                properties: {
                    appLogsConfiguration: {},
                    vnetConfiguration: {},
                    peerAuthentication: { mtls: { enabled: true } },
                    peerTrafficConfiguration: { encryption: { enabled: true } },
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeDefined();
            expect(result.enableMtls).toBe(true);
            expect(result.enablePeerToPeerEncryption).toBe(true);
        });

        it('parses zoneRedundant and tags correctly', async () => {
            const showJson = JSON.stringify({
                properties: {
                    appLogsConfiguration: {},
                    vnetConfiguration: {},
                    peerAuthentication: {},
                    peerTrafficConfiguration: {},
                    zoneRedundant: true,
                },
                tags: { env: 'staging', merlin: 'true' },
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeDefined();
            expect(result.zoneRedundant).toBe(true);
            expect(result.tags).toEqual({ env: 'staging', merlin: 'true' });
        });

        it('omits undefined values from returned config', async () => {
            const showJson = JSON.stringify({
                properties: {
                    appLogsConfiguration: { destination: 'none' },
                    vnetConfiguration: {},
                    peerAuthentication: {},
                    peerTrafficConfiguration: {},
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const result = await (render as any).getDeployedProps(resource);
            expect(result).toBeDefined();
            // Fields not in the response should not appear in result
            const keys = Object.keys(result);
            expect(keys.every(k => result[k] !== undefined)).toBe(true);
        });
    });
});
