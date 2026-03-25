import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureFunctionAppRender,
    AzureFunctionAppResource,
    AzureFunctionAppConfig,
    AZURE_FUNCTION_APP_RESOURCE_TYPE,
} from '../azureFunctionApp.js';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

function makeResource(
    config: Partial<AzureFunctionAppConfig> = {},
    overrides: Partial<Omit<AzureFunctionAppResource, 'config'>> = {}
): AzureFunctionAppResource {
    return {
        name: 'func',
        type: AZURE_FUNCTION_APP_RESOURCE_TYPE,
        ring: 'staging',
        region: 'koreacentral',
        project: 'merlin',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            image: 'myacr.azurecr.io/trinity/func:nightly',
            storageAccount: 'merlinstorage',
            cpu: 0.5,
            memory: '1Gi',
            ...config,
        },
        ...overrides,
    } as AzureFunctionAppResource;
}

function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

function findCreate(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args[0] === 'functionapp' && c.args[1] === 'create');
}

function findAppSettings(commands: { command: string; args: string[] }[]) {
    return commands.find(c => c.command === 'az' && c.args.includes('appsettings') && c.args.includes('set'));
}

function findContainerSet(commands: { command: string; args?: string[] }[]) {
    return commands.find(c => {
        const argStr = c.args?.join(' ') || '';
        return argStr.includes('config container set');
    });
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
            tags: { merlin: 'true' },
        }) as any;
    });
}

describe('AzureFunctionAppRender', () => {
    let render: AzureFunctionAppRender;

    beforeEach(() => {
        render = new AzureFunctionAppRender();
        vi.resetAllMocks();
    });

    it('getShortResourceTypeName returns func', () => {
        expect(render.getShortResourceTypeName()).toBe('func');
    });

    it('supportConnectorInResourceName is true', () => {
        expect(render.supportConnectorInResourceName).toBe(true);
    });

    it('derives correct resource name with connector', () => {
        const resource = makeResource();
        expect(render.getResourceName(resource)).toBe('merlin-func-stg-krc-func');
    });

    describe('renderCreate', () => {
        beforeEach(() => mockNotFound());

        it('emits az functionapp create with required flags', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands);
            expect(cmd).toBeDefined();
            expect(hasParam(cmd!.args, '--name', 'merlin-func-stg-krc-func')).toBe(true);
            expect(hasParam(cmd!.args, '--resource-group', 'merlin-rg-stg-krc')).toBe(true);
        });

        it('includes --storage-account', async () => {
            const resource = makeResource({ storageAccount: 'mystorage' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--storage-account', 'mystorage')).toBe(true);
        });

        it('includes --image for container-based', async () => {
            const resource = makeResource({ image: 'myacr.azurecr.io/app:v1' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--image', 'myacr.azurecr.io/app:v1')).toBe(true);
        });

        it('includes --environment for ACAE hosting', async () => {
            const resource = makeResource({ environment: 'my-env' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--environment', 'my-env')).toBe(true);
        });

        it('includes --consumption-plan-location when no environment', async () => {
            const resource = makeResource({ environment: undefined, consumptionPlanLocation: 'koreacentral' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--consumption-plan-location', 'koreacentral')).toBe(true);
        });

        it('includes --cpu and --memory', async () => {
            const resource = makeResource({ cpu: 1.0, memory: '2Gi' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--cpu', '1')).toBe(true);
            expect(hasParam(cmd.args, '--memory', '2Gi')).toBe(true);
        });

        it('includes --assign-identity [system]', async () => {
            const resource = makeResource();
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--assign-identity', '[system]')).toBe(true);
        });

        it('includes --functions-version', async () => {
            const resource = makeResource({ functionsVersion: '4' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--functions-version', '4')).toBe(true);
        });

        it('includes --runtime and --runtime-version', async () => {
            const resource = makeResource({ runtime: 'node', runtimeVersion: '20' });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--runtime', 'node')).toBe(true);
            expect(hasParam(cmd.args, '--runtime-version', '20')).toBe(true);
        });

        it('includes --min-replicas and --max-replicas', async () => {
            const resource = makeResource({ minReplicas: 0, maxReplicas: 5 });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(hasParam(cmd.args, '--min-replicas', '0')).toBe(true);
            expect(hasParam(cmd.args, '--max-replicas', '5')).toBe(true);
        });

        it('includes --tags on create', async () => {
            const resource = makeResource({ tags: { env: 'staging', merlin: 'true' } });
            const commands = await render.render(resource);
            const cmd = findCreate(commands)!;
            expect(cmd.args).toContain('--tags');
            expect(cmd.args).toContain('env=staging');
        });
    });

    describe('renderUpdate', () => {
        beforeEach(() => mockExists());

        it('emits container set command for image update', async () => {
            const resource = makeResource({ image: 'myacr.azurecr.io/app:v2' });
            const commands = await render.render(resource);
            const cmd = findContainerSet(commands);
            expect(cmd).toBeDefined();
        });
    });

    describe('renderAppSettings', () => {
        beforeEach(() => mockNotFound());

        it('emits appsettings set when envVars are specified', async () => {
            const resource = makeResource({ envVars: ['KEY1=value1', 'KEY2=value2'] });
            const commands = await render.render(resource);
            const cmd = findAppSettings(commands);
            expect(cmd).toBeDefined();
            expect(cmd!.args).toContain('--settings');
            expect(cmd!.args).toContain('KEY1=value1 KEY2=value2');
        });

        it('does not emit appsettings set when no envVars', async () => {
            const resource = makeResource({ envVars: undefined });
            const commands = await render.render(resource);
            const cmd = findAppSettings(commands);
            expect(cmd).toBeUndefined();
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
        await expect(render.render(resource)).rejects.toThrow('not an AzureFunctionApp resource');
    });
});
