import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    AzureContainerAppRender,
    AzureContainerAppResource,
    AzureContainerAppConfig,
    AZURE_CONTAINER_APP_TYPE,
} from '../azureContainerApp.js';
import { Resource } from '../../common/resource.js';

// Mock child_process so execSync is replaceable in tests
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureContainerAppConfig> = {},
    overrides: Partial<Omit<AzureContainerAppResource, 'config'>> = {}
): AzureContainerAppResource {
    return {
        name: 'myapp',
        type: AZURE_CONTAINER_APP_TYPE,
        ring: 'staging',
        region: 'eastus',
        project: 'myproject',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        resourceGroup: 'myproject-rg-stg-eus',
        config: {
            image: 'mcr.microsoft.com/azuredocs/aca-helloworld:latest',
            environment: 'my-container-env',
            ...config,
        },
        ...overrides,
    } as AzureContainerAppResource;
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

describe('AzureContainerAppRender', () => {
    let render: AzureContainerAppRender;

    beforeEach(() => {
        render = new AzureContainerAppRender();
        // Reset only call history; implementations are set per-test
        vi.resetAllMocks();
    });

    // ── 1. Basic metadata ────────────────────────────────────────────────────

    describe('getShortResourceTypeName', () => {
        it('returns aca', () => {
            expect(render.getShortResourceTypeName()).toBe('aca');
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
            // project=myproject, name=myapp, ring=staging→stg, region=eastus→eus, type=aca
            expect(render.getResourceName(resource)).toBe('myproject-myapp-stg-eus-aca');
        });

        it('uses "shared" when no project is set', () => {
            const resource = makeResource({}, { project: undefined });
            expect(render.getResourceName(resource)).toBe('shared-myapp-stg-eus-aca');
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
                'is not an Azure Container App resource'
            );
        });

        it('routes to create when resource does not exist', async () => {
            mockNotFound();
            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp create')).toBe(true);
        });

        it('routes to update when resource exists', async () => {
            const showResponse = JSON.stringify({
                template: {
                    containers: [{ image: 'old-image', name: 'c', resources: { cpu: '0.5', memory: '1Gi' } }],
                    scale: {},
                },
                configuration: { revisionMode: 'Single' },
                tags: {},
            });
            mockResourceExists(showResponse);

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp update')).toBe(true);
        });
    });

    // ── 4. CPU / memory validation ───────────────────────────────────────────

    describe('cpu + memory validation in renderImpl()', () => {
        it('accepts valid cpu/memory combinations', async () => {
            const validCombinations: Array<[number, string]> = [
                [0.25, '0.5Gi'],
                [0.5,  '1.0Gi'],
                [1.0,  '2.0Gi'],
                [2.0,  '4.0Gi'],
                [4.0,  '8.0Gi'],
            ];
            for (const [cpu, memory] of validCombinations) {
                mockNotFound();
                const resource = makeResource({ cpu, memory });
                await expect(render.render(resource as unknown as Resource)).resolves.toBeDefined();
            }
        });

        it('also accepts memory without trailing .0 (e.g. "1Gi" for cpu 0.5)', async () => {
            mockNotFound();
            const resource = makeResource({ cpu: 0.5, memory: '1Gi' });
            await expect(render.render(resource as unknown as Resource)).resolves.toBeDefined();
        });

        it('throws when cpu is given without memory', async () => {
            mockNotFound();
            const resource = makeResource({ cpu: 1.0 });
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'cpu and memory must both be specified together'
            );
        });

        it('throws when memory is given without cpu', async () => {
            mockNotFound();
            const resource = makeResource({ memory: '2.0Gi' });
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'cpu and memory must both be specified together'
            );
        });

        it('throws when cpu value is not in the valid set', async () => {
            mockNotFound();
            const resource = makeResource({ cpu: 0.1, memory: '0.2Gi' });
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'invalid cpu value 0.1'
            );
        });

        it('throws when memory does not match the expected value for the given cpu', async () => {
            mockNotFound();
            // cpu 1.0 requires memory 2.0Gi, not 1.0Gi
            const resource = makeResource({ cpu: 1.0, memory: '1Gi' });
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'invalid cpu/memory combination'
            );
        });

        it('error message for invalid combination names the required memory', async () => {
            mockNotFound();
            const resource = makeResource({ cpu: 0.5, memory: '2.0Gi' });
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'memory must be 1.0Gi'
            );
        });

        it('does not validate when neither cpu nor memory is set', async () => {
            mockNotFound();
            const resource = makeResource({ cpu: undefined, memory: undefined });
            await expect(render.render(resource as unknown as Resource)).resolves.toBeDefined();
        });
    });

    // ── 5. renderCreate ──────────────────────────────────────────────────────

    describe('renderCreate()', () => {
        it('produces az containerapp create as the base command', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('containerapp');
            expect(cmd.args[1]).toBe('create');
        });

        it('includes --name and --resource-group', () => {
            const resource = makeResource();
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-myapp-stg-eus-aca')).toBe(true);
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        it('includes --image', () => {
            const resource = makeResource({ image: 'myimage:latest' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--image', 'myimage:latest')).toBe(true);
        });

        it('includes --environment (create-only)', () => {
            const resource = makeResource({ environment: 'my-env' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--environment', 'my-env')).toBe(true);
        });

        it('includes --ingress (create-only)', () => {
            const resource = makeResource({ ingress: 'external' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--ingress', 'external')).toBe(true);
        });

        it('includes --target-port (create-only)', () => {
            const resource = makeResource({ targetPort: 8080 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--target-port', '8080')).toBe(true);
        });

        it('includes --transport (create-only)', () => {
            const resource = makeResource({ transport: 'http2' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--transport', 'http2')).toBe(true);
        });

        it('includes --exposed-port (create-only)', () => {
            const resource = makeResource({ exposedPort: 443 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--exposed-port', '443')).toBe(true);
        });

        it('includes --allow-insecure true (create-only)', () => {
            const resource = makeResource({ allowInsecure: true });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--allow-insecure', 'true')).toBe(true);
        });

        it('includes --allow-insecure false (create-only)', () => {
            const resource = makeResource({ allowInsecure: false });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--allow-insecure', 'false')).toBe(true);
        });

        it('includes --system-assigned (presence-only, create-only)', () => {
            const resource = makeResource({ systemAssigned: true });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--system-assigned');
            expect(idx).not.toBe(-1);
            // Presence-only flag — must NOT be followed by 'true' or 'false'
            expect(args[idx + 1]).not.toBe('true');
            expect(args[idx + 1]).not.toBe('false');
        });

        it('includes --user-assigned (create-only, array)', () => {
            const resource = makeResource({ userAssigned: ['/subscriptions/abc/id1', '/subscriptions/abc/id2'] });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--user-assigned');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).toBe('/subscriptions/abc/id1 /subscriptions/abc/id2');
        });

        it('includes --workload-profile-name (create-only)', () => {
            const resource = makeResource({ workloadProfileName: 'Consumption' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--workload-profile-name', 'Consumption')).toBe(true);
        });

        it('includes --args (container args, create-only)', () => {
            const resource = makeResource({ args: ['--foo', 'bar'] });
            const cmdArgs = render.renderCreate(resource)[0].args;
            const idx = cmdArgs.indexOf('--args');
            expect(idx).not.toBe(-1);
            expect(cmdArgs[idx + 1]).toBe('--foo bar');
        });

        it('includes --command (container command, create-only)', () => {
            const resource = makeResource({ command: ['/bin/sh', '-c', 'echo hello'] });
            const cmdArgs = render.renderCreate(resource)[0].args;
            const idx = cmdArgs.indexOf('--command');
            expect(idx).not.toBe(-1);
            expect(cmdArgs[idx + 1]).toBe('/bin/sh -c echo hello');
        });

        it('includes --env-vars as space-joined array', () => {
            const resource = makeResource({ envVars: ['KEY1=VAL1', 'KEY2=VAL2'] });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--env-vars');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).toBe('KEY1=VAL1 KEY2=VAL2');
        });

        it('includes --secrets as space-joined array', () => {
            const resource = makeResource({ secrets: ['mysecret=secretvalue'] });
            const args = render.renderCreate(resource)[0].args;
            const idx = args.indexOf('--secrets');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).toBe('mysecret=secretvalue');
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

        it('includes full Dapr config', () => {
            const resource = makeResource({
                enableDapr: true,
                daprAppId: 'my-dapr-app',
                daprAppPort: 3500,
                daprAppProtocol: 'grpc',
                daprHttpMaxRequestSize: 4,
                daprHttpReadBufferSize: 4,
                daprLogLevel: 'info',
                daprEnableApiLogging: true,
            });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--enable-dapr', 'true')).toBe(true);
            expect(hasParam(args, '--dapr-app-id', 'my-dapr-app')).toBe(true);
            expect(hasParam(args, '--dapr-app-port', '3500')).toBe(true);
            expect(hasParam(args, '--dapr-app-protocol', 'grpc')).toBe(true);
            expect(hasParam(args, '--dapr-http-max-request-size', '4')).toBe(true);
            expect(hasParam(args, '--dapr-http-read-buffer-size', '4')).toBe(true);
            expect(hasParam(args, '--dapr-log-level', 'info')).toBe(true);
            expect(hasParam(args, '--dapr-enable-api-logging', 'true')).toBe(true);
        });

        it('includes scaling params', () => {
            const resource = makeResource({ minReplicas: 1, maxReplicas: 10 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--min-replicas', '1')).toBe(true);
            expect(hasParam(args, '--max-replicas', '10')).toBe(true);
        });

        it('includes scale rule params', () => {
            const resource = makeResource({
                scaleRuleName: 'my-rule',
                scaleRuleType: 'http',
                scaleRuleHttpConcurrency: 100,
                scaleRuleMetadata: ['concurrentRequests=100'],
                scaleRuleAuth: ['connection=my-secret'],
            });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--scale-rule-name', 'my-rule')).toBe(true);
            expect(hasParam(args, '--scale-rule-type', 'http')).toBe(true);
            expect(hasParam(args, '--scale-rule-http-concurrency', '100')).toBe(true);
            const metaIdx = args.indexOf('--scale-rule-metadata');
            expect(metaIdx).not.toBe(-1);
            expect(args[metaIdx + 1]).toBe('concurrentRequests=100');
            const authIdx = args.indexOf('--scale-rule-auth');
            expect(authIdx).not.toBe(-1);
            expect(args[authIdx + 1]).toBe('connection=my-secret');
        });

        it('includes --tags', () => {
            const resource = makeResource({ tags: { env: 'staging', owner: 'team' } });
            const args = render.renderCreate(resource)[0].args;
            const tagsIdx = args.indexOf('--tags');
            expect(tagsIdx).not.toBe(-1);
            // Each tag is its own args element so execa() passes them as separate
            // subprocess arguments to Azure CLI.
            expect(args).toContain('env=staging');
            expect(args).toContain('owner=team');
        });

        it('includes registry credentials', () => {
            const resource = makeResource({
                registryServer: 'myregistry.azurecr.io',
                registryUsername: 'myuser',
                registryPassword: 'mypass',
                registryIdentity: '/subscriptions/abc/identity',
            });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--registry-server', 'myregistry.azurecr.io')).toBe(true);
            expect(hasParam(args, '--registry-username', 'myuser')).toBe(true);
            expect(hasParam(args, '--registry-password', 'mypass')).toBe(true);
            expect(hasParam(args, '--registry-identity', '/subscriptions/abc/identity')).toBe(true);
        });

        it('includes --secret-volume-mount', () => {
            const resource = makeResource({ secretVolumeMount: '/mnt/secrets' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--secret-volume-mount', '/mnt/secrets')).toBe(true);
        });

        it('includes --revision-suffix', () => {
            const resource = makeResource({ revisionSuffix: 'v2' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--revision-suffix', 'v2')).toBe(true);
        });

        it('includes --revisions-mode', () => {
            const resource = makeResource({ revisionsMode: 'multiple' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--revisions-mode', 'multiple')).toBe(true);
        });

        it('includes --cpu and --memory', () => {
            const resource = makeResource({ cpu: 0.5, memory: '1Gi' });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--cpu', '0.5')).toBe(true);
            expect(hasParam(args, '--memory', '1Gi')).toBe(true);
        });

        it('includes --termination-grace-period', () => {
            const resource = makeResource({ terminationGracePeriod: 30 });
            const args = render.renderCreate(resource)[0].args;
            expect(hasParam(args, '--termination-grace-period', '30')).toBe(true);
        });
    });

    // ── 6. renderUpdate ──────────────────────────────────────────────────────

    describe('renderUpdate()', () => {
        it('produces az containerapp update as the base command', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('containerapp');
            expect(cmd.args[1]).toBe('update');
        });

        it('includes --name and --resource-group', () => {
            const resource = makeResource();
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--name', 'myproject-myapp-stg-eus-aca')).toBe(true);
            expect(hasParam(args, '--resource-group', 'myproject-rg-stg-eus')).toBe(true);
        });

        // Create-only params must be absent in update
        const createOnlyFlags = [
            '--environment',
            '--workload-profile-name',
            '--ingress',
            '--target-port',
            '--transport',
            '--exposed-port',
            '--allow-insecure',
            '--system-assigned',
            '--user-assigned',
            '--args',
            '--command',
        ];

        for (const flag of createOnlyFlags) {
            it(`does NOT include ${flag} in update`, () => {
                const resource = makeResource({
                    environment: 'env',
                    workloadProfileName: 'Consumption',
                    ingress: 'external',
                    targetPort: 80,
                    transport: 'http',
                    exposedPort: 443,
                    allowInsecure: true,
                    systemAssigned: true,
                    userAssigned: ['/id1'],
                    args: ['arg'],
                    command: ['/bin/sh'],
                });
                const args = render.renderUpdate(resource)[0].args;
                expect(args.includes(flag)).toBe(false);
            });
        }

        it('includes shared simple params (image, cpu, memory)', () => {
            const resource = makeResource({ image: 'newimage:v2', cpu: 1, memory: '2Gi' });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--image', 'newimage:v2')).toBe(true);
            expect(hasParam(args, '--cpu', '1')).toBe(true);
            expect(hasParam(args, '--memory', '2Gi')).toBe(true);
        });

        it('includes --min-replicas and --max-replicas', () => {
            const resource = makeResource({ minReplicas: 2, maxReplicas: 5 });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--min-replicas', '2')).toBe(true);
            expect(hasParam(args, '--max-replicas', '5')).toBe(true);
        });

        it('includes --enable-dapr and --dapr-enable-api-logging (shared boolean flags)', () => {
            const resource = makeResource({ enableDapr: false, daprEnableApiLogging: true });
            const args = render.renderUpdate(resource)[0].args;
            expect(hasParam(args, '--enable-dapr', 'false')).toBe(true);
            expect(hasParam(args, '--dapr-enable-api-logging', 'true')).toBe(true);
        });

        it('includes --env-vars (shared array)', () => {
            const resource = makeResource({ envVars: ['KEY=VAL'] });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--env-vars')).toBe(true);
        });

        it('appends --no-wait when noWait is true', () => {
            const resource = makeResource({ noWait: true });
            const args = render.renderUpdate(resource)[0].args;
            const idx = args.indexOf('--no-wait');
            expect(idx).not.toBe(-1);
            expect(args[idx + 1]).not.toBe('true');
        });

        it('does NOT include --no-wait when noWait is false', () => {
            const resource = makeResource({ noWait: false });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--no-wait')).toBe(false);
        });

        it('includes --tags in update', () => {
            const resource = makeResource({ tags: { env: 'prod' } });
            const args = render.renderUpdate(resource)[0].args;
            expect(args.includes('--tags')).toBe(true);
        });
    });

    // ── 7. getDeployedProps (via render with mocked execSync) ───────────────

    describe('getDeployedProps (via render())', () => {

        it('maps container fields from show response', async () => {
            const showJson = JSON.stringify({
                template: {
                    containers: [{
                        image: 'mcr.microsoft.com/test:v1',
                        name: 'mycontainer',
                        resources: { cpu: '0.25', memory: '512Mi' },
                        env: [
                            { name: 'KEY1', value: 'VAL1' },
                            { name: 'SECRET_KEY', secretRef: 'my-secret' },
                        ],
                    }],
                    scale: { minReplicas: 1, maxReplicas: 3 },
                    terminationGracePeriodSeconds: 60,
                },
                configuration: {
                    revisionMode: 'Single',
                    ingress: { external: true, targetPort: 80, transport: 'auto', allowInsecure: false },
                    dapr: {
                        enabled: true,
                        appId: 'test-app',
                        appPort: 3500,
                        appProtocol: 'http',
                        logLevel: 'info',
                        enableApiLogging: false,
                    },
                    registries: [{ server: 'myreg.azurecr.io', username: 'user', identity: '/id' }],
                },
                identity: {
                    type: 'SystemAssigned, UserAssigned',
                    userAssignedIdentities: { '/subscriptions/abc/id1': {} },
                },
                properties: { workloadProfileName: 'Consumption' },
                tags: { team: 'infra' },
            });
            mockResourceExists(showJson);

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);

            // Should have taken the update path
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp update')).toBe(true);
        });

        it('maps ingress.external=true → "external"', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img' }], scale: {} },
                configuration: { ingress: { external: true, targetPort: 443 } },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            // Access protected method via cast
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.ingress).toBe('external');
        });

        it('maps ingress.external=false → "internal"', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img' }], scale: {} },
                configuration: { ingress: { external: false, targetPort: 80 } },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.ingress).toBe('internal');
        });

        it('maps cpu as a float (parseFloat)', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img', resources: { cpu: '0.75', memory: '1Gi' } }], scale: {} },
                configuration: {},
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.cpu).toBe(0.75);
            expect(typeof deployedProps?.cpu).toBe('number');
        });

        it('maps revisionMode to lowercase', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img' }], scale: {} },
                configuration: { revisionMode: 'Multiple' },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.revisionsMode).toBe('multiple');
        });

        it('maps userAssigned identities from object keys', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img' }], scale: {} },
                configuration: {},
                identity: {
                    type: 'UserAssigned',
                    userAssignedIdentities: {
                        '/subscriptions/abc/id1': {},
                        '/subscriptions/abc/id2': {},
                    },
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.userAssigned).toEqual([
                '/subscriptions/abc/id1',
                '/subscriptions/abc/id2',
            ]);
        });

        it('does NOT map secrets (write-only)', async () => {
            const showJson = JSON.stringify({
                template: { containers: [{ image: 'img' }], scale: {} },
                configuration: {
                    secrets: [{ name: 'my-secret' }], // value is always redacted
                },
                tags: {},
            });
            mockExecSync.mockReturnValue(showJson as any);

            const resource = makeResource();
            const deployedProps = await (render as any).getDeployedProps(resource);
            expect(deployedProps?.secrets).toBeUndefined();
        });

        it('returns undefined (create path) when exit code is 3', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('not found');
                err.status = 3;
                throw err;
            });

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp create')).toBe(true);
        });

        it('returns undefined (create path) when exit code is 1', async () => {
            mockExecSync.mockImplementation(() => {
                const err: any = new Error('not found');
                err.status = 1;
                throw err;
            });

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp create')).toBe(true);
        });

        it('returns undefined (create path) when error contains ResourceNotFound', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('containerapp show')) {
                    throw new Error('ResourceNotFound: The resource was not found');
                }
                return JSON.stringify({}) as any;
            });

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp create')).toBe(true);
        });

        it('returns undefined (create path) when error contains ResourceGroupNotFound', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('containerapp show')) {
                    throw new Error('ResourceGroupNotFound');
                }
                return JSON.stringify({}) as any;
            });

            const resource = makeResource();
            const commands = await render.render(resource as unknown as Resource);
            const subcommands = commands.map(c => c.args.slice(0, 2).join(' '));
            expect(subcommands.some(s => s === 'containerapp create')).toBe(true);
        });

        it('throws on genuine unexpected errors from containerapp show', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (String(cmd).includes('containerapp show')) {
                    const err: any = new Error('Network timeout');
                    err.status = 255;
                    throw err;
                }
                return JSON.stringify({}) as any;
            });

            const resource = makeResource();
            await expect(render.render(resource as unknown as Resource)).rejects.toThrow(
                'Failed to get deployed properties for container app'
            );
        });
    });
});
