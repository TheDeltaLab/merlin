import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureContainerRegistryRender,
    AzureContainerRegistryResource,
    AzureContainerRegistryConfig,
    AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE,
} from '../azureContainerRegistry.js';

// Mock child_process so execSync is replaceable in tests
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureContainerRegistryConfig> = {},
    overrides: Partial<Omit<AzureContainerRegistryResource, 'config'>> = {}
): AzureContainerRegistryResource {
    return {
        name: 'myacr',
        type: AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE,
        ring: 'staging',
        region: 'eastus',
        project: 'myproject',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        resourceGroup: 'myproject-rg-stg-eus',
        config: {
            sku: 'Standard',
            ...config,
        },
        ...overrides,
    } as AzureContainerRegistryResource;
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

describe('AzureContainerRegistryRender', () => {
    let render: AzureContainerRegistryRender;

    beforeEach(() => {
        render = new AzureContainerRegistryRender();
        vi.resetAllMocks();
    });

    describe('getShortResourceTypeName()', () => {
        it('returns "acr"', () => {
            expect(render.getShortResourceTypeName()).toBe('acr');
        });
    });

    describe('images - no images', () => {
        it('does not generate extra commands when images is undefined', async () => {
            mockNotFound();
            const resource = makeResource({ sku: 'Standard' });
            const commands = await render.render(resource);
            // Should only have RG create + ACR create — no acr login, no docker, no import
            expect(commands.some(c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr'))).toBe(false);
            expect(commands.some(c => c.command === 'az' && c.args.includes('import'))).toBe(false);
            expect(commands.some(c => c.command === 'bash')).toBe(false);
            expect(commands.some(c => c.command === 'docker')).toBe(false);
        });

        it('does not generate extra commands when images is empty array', async () => {
            mockNotFound();
            const resource = makeResource({ images: [] });
            const commands = await render.render(resource);
            expect(commands.some(c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr'))).toBe(false);
            expect(commands.some(c => c.command === 'az' && c.args.includes('import'))).toBe(false);
            expect(commands.some(c => c.command === 'bash')).toBe(false);
            expect(commands.some(c => c.command === 'docker')).toBe(false);
        });
    });

    describe('images - source import', () => {
        it('generates az acr import per tag for a source image (no docker commands, no acr login)', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    {
                        name: 'nginx',
                        tags: ['latest', 'v1.0'],
                        source: 'docker.io/library/nginx:alpine',
                    },
                ],
            });

            const commands = await render.render(resource);

            // No acr login commands
            expect(commands.some(c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr'))).toBe(false);

            // No docker commands
            expect(commands.some(c => c.command === 'docker')).toBe(false);

            // One az acr import per tag
            const importCmds = commands.filter(c => c.command === 'az' && c.args.includes('import'));
            expect(importCmds).toHaveLength(2);

            // ACR name: supportConnectorInResourceName=false → myprojectmyacrstgeusacr
            expect(hasParam(importCmds[0].args, '--name', 'myprojectmyacrstgeusacr')).toBe(true);
            expect(hasParam(importCmds[0].args, '--source', 'docker.io/library/nginx:alpine')).toBe(true);
            expect(hasParam(importCmds[0].args, '--image', 'nginx:latest')).toBe(true);

            expect(hasParam(importCmds[1].args, '--name', 'myprojectmyacrstgeusacr')).toBe(true);
            expect(hasParam(importCmds[1].args, '--source', 'docker.io/library/nginx:alpine')).toBe(true);
            expect(hasParam(importCmds[1].args, '--image', 'nginx:v1.0')).toBe(true);
        });

        it('generates az acr import for multiple source images without --no-wait', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                    { name: 'redis', tags: ['7.0', '7.2'], source: 'docker.io/library/redis:7' },
                ],
            });

            const commands = await render.render(resource);

            // No acr login, no docker
            expect(commands.some(c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr'))).toBe(false);
            expect(commands.some(c => c.command === 'docker')).toBe(false);

            // nginx:1 tag → 1 import; redis:2 tags → 2 imports = 3 total
            const importCmds = commands.filter(c => c.command === 'az' && c.args.includes('import'));
            expect(importCmds).toHaveLength(3);

            expect(hasParam(importCmds[0].args, '--image', 'nginx:latest')).toBe(true);
            expect(hasParam(importCmds[1].args, '--image', 'redis:7.0')).toBe(true);
            expect(hasParam(importCmds[2].args, '--image', 'redis:7.2')).toBe(true);
        });

        it('does not include --no-wait in az acr import commands', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                ],
            });

            const commands = await render.render(resource);
            const importCmds = commands.filter(c => c.command === 'az' && c.args.includes('import'));
            expect(importCmds).toHaveLength(1);
            expect(importCmds[0].args).not.toContain('--no-wait');
        });

        it('works correctly for ACR source endpoints (no login needed)', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    {
                        name: 'alluneed',
                        tags: ['latest'],
                        source: 'brainlytest-c4cscpe6b9b5f8fq.azurecr.io/alluneed:latest',
                    },
                ],
            });

            const commands = await render.render(resource);

            // No acr login at all
            expect(commands.some(c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr'))).toBe(false);

            // One az acr import
            const importCmds = commands.filter(c => c.command === 'az' && c.args.includes('import'));
            expect(importCmds).toHaveLength(1);
            expect(hasParam(importCmds[0].args, '--name', 'myprojectmyacrstgeusacr')).toBe(true);
            expect(hasParam(importCmds[0].args, '--source', 'brainlytest-c4cscpe6b9b5f8fq.azurecr.io/alluneed:latest')).toBe(true);
            expect(hasParam(importCmds[0].args, '--image', 'alluneed:latest')).toBe(true);
        });
    });

    describe('images - generateScript build', () => {
        it('generates az acr login + bash + docker tag + docker push for single tag', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    {
                        name: 'customapp',
                        tags: ['latest'],
                        generateScript: './scripts/build.sh',
                    },
                ],
            });

            const commands = await render.render(resource);

            // Must have exactly one az acr login
            const loginCmds = commands.filter(
                c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr')
            );
            expect(loginCmds).toHaveLength(1);
            expect(hasParam(loginCmds[0].args, '--name', 'myprojectmyacrstgeusacr')).toBe(true);

            // No az acr import
            expect(commands.some(c => c.command === 'az' && c.args.includes('import'))).toBe(false);

            const bashCmds = commands.filter(c => c.command === 'bash');
            const tagCmds = commands.filter(c => c.command === 'docker' && c.args[0] === 'tag');
            const pushCmds = commands.filter(c => c.command === 'docker' && c.args[0] === 'push');

            expect(bashCmds).toHaveLength(1);
            expect(bashCmds[0].args).toEqual(['./scripts/build.sh']);

            expect(tagCmds).toHaveLength(1);
            expect(tagCmds[0].args[1]).toBe('$MERLIN_ACR_IMAGE');
            expect(tagCmds[0].args[2]).toBe('myprojectmyacrstgeusacr.azurecr.io/customapp:latest');

            expect(pushCmds).toHaveLength(1);
            expect(pushCmds[0].args[1]).toBe('myprojectmyacrstgeusacr.azurecr.io/customapp:latest');
        });

        it('generates one bash command and docker tag + push per tag for multiple tags', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    {
                        name: 'customapp',
                        tags: ['latest', 'v2.0', 'v2.1'],
                        generateScript: './scripts/build.sh',
                    },
                ],
            });

            const commands = await render.render(resource);

            // Must have exactly one az acr login
            const loginCmds = commands.filter(
                c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr')
            );
            expect(loginCmds).toHaveLength(1);

            const bashCmds = commands.filter(c => c.command === 'bash');
            const tagCmds = commands.filter(c => c.command === 'docker' && c.args[0] === 'tag');
            const pushCmds = commands.filter(c => c.command === 'docker' && c.args[0] === 'push');

            // Script runs only once
            expect(bashCmds).toHaveLength(1);
            // One docker tag + push per tag
            expect(tagCmds).toHaveLength(3);
            expect(pushCmds).toHaveLength(3);

            expect(tagCmds[0].args[2]).toBe('myprojectmyacrstgeusacr.azurecr.io/customapp:latest');
            expect(tagCmds[1].args[2]).toBe('myprojectmyacrstgeusacr.azurecr.io/customapp:v2.0');
            expect(tagCmds[2].args[2]).toBe('myprojectmyacrstgeusacr.azurecr.io/customapp:v2.1');
        });

        it('uses correct loginServer format <registryName>.azurecr.io', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'app', tags: ['latest'], generateScript: './build.sh' },
                ],
            });

            const commands = await render.render(resource);
            const registryName = render.getResourceName(resource);
            const expectedLoginServer = `${registryName}.azurecr.io`;

            const pushCmds = commands.filter(c => c.command === 'docker' && c.args[0] === 'push');
            expect(pushCmds[0].args[1]).toContain(expectedLoginServer);
        });
    });

    describe('images - mixed source and generateScript', () => {
        it('handles multiple images with different types in order', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                    { name: 'customapp', tags: ['v1'], generateScript: './build.sh' },
                ],
            });

            const commands = await render.render(resource);
            const imageCommands = commands.filter(
                c => (c.command === 'az' && (c.args.includes('login') || c.args.includes('import'))) ||
                     c.command === 'bash' ||
                     c.command === 'docker'
            );

            // 1 az acr login (for generateScript) + 1 az acr import (for source) + 1 bash + 1 tag + 1 push = 5
            expect(imageCommands).toHaveLength(5);
            expect(imageCommands[0].command).toBe('az');         // az acr login
            expect(imageCommands[0].args).toContain('login');
            expect(imageCommands[1].command).toBe('az');         // az acr import nginx:latest
            expect(imageCommands[1].args).toContain('import');
            expect(imageCommands[2].command).toBe('bash');       // bash ./build.sh
            expect(imageCommands[3].command).toBe('docker');     // docker tag $MERLIN_ACR_IMAGE .../customapp:v1
            expect(imageCommands[3].args[0]).toBe('tag');
            expect(imageCommands[4].command).toBe('docker');     // docker push .../customapp:v1
            expect(imageCommands[4].args[0]).toBe('push');
        });

        it('emits exactly one az acr login for mixed source and generateScript images', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                    { name: 'customapp', tags: ['v1'], generateScript: './build.sh' },
                ],
            });

            const commands = await render.render(resource);
            const loginCmds = commands.filter(
                c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr')
            );
            expect(loginCmds).toHaveLength(1);
        });

        it('emits no acr login when there are only source images', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                    { name: 'redis', tags: ['7.0'], source: 'docker.io/library/redis:7' },
                ],
            });

            const commands = await render.render(resource);
            const loginCmds = commands.filter(
                c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr')
            );
            expect(loginCmds).toHaveLength(0);
        });
    });

    describe('images - validation errors', () => {
        it('throws when neither source nor generateScript is specified', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'badimage', tags: ['latest'] } as any,
                ],
            });

            await expect(render.render(resource)).rejects.toThrow(
                `must specify either 'source' or 'generateScript'`
            );
        });

        it('throws when both source and generateScript are specified', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    {
                        name: 'badimage',
                        tags: ['latest'],
                        source: 'docker.io/library/nginx:alpine',
                        generateScript: './build.sh',
                    },
                ],
            });

            await expect(render.render(resource)).rejects.toThrow(
                `cannot specify both 'source' and 'generateScript'`
            );
        });

        it('error message includes image name and resource name', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'myimage', tags: ['latest'] } as any,
                ],
            });

            await expect(render.render(resource)).rejects.toThrow(`Image 'myimage'`);
            await expect(render.render(resource)).rejects.toThrow(`resource 'myacr'`);
        });
    });

    describe('images - commands appended after create/update', () => {
        it('az acr import comes after acr create', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                ],
            });

            const commands = await render.render(resource);
            const acrCreateIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('create') && c.args.includes('acr')
            );
            const importIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('import')
            );

            expect(acrCreateIdx).toBeGreaterThanOrEqual(0);
            expect(importIdx).toBeGreaterThan(acrCreateIdx);
        });

        it('az acr import comes after acr update', async () => {
            mockResourceExists(JSON.stringify({
                sku: { name: 'Standard' },
                location: 'eastus',
                adminUserEnabled: false,
                publicNetworkAccess: 'Enabled',
                tags: {},
            }));
            const resource = makeResource({
                images: [
                    { name: 'nginx', tags: ['latest'], source: 'docker.io/library/nginx:alpine' },
                ],
            });

            const commands = await render.render(resource);
            const acrUpdateIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('update') && c.args.includes('acr')
            );
            const importIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('import')
            );

            expect(acrUpdateIdx).toBeGreaterThanOrEqual(0);
            expect(importIdx).toBeGreaterThan(acrUpdateIdx);
        });

        it('az acr login comes after acr create and before docker commands (generateScript)', async () => {
            mockNotFound();
            const resource = makeResource({
                images: [
                    { name: 'customapp', tags: ['latest'], generateScript: './build.sh' },
                ],
            });

            const commands = await render.render(resource);
            const acrCreateIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('create') && c.args.includes('acr')
            );
            const acrLoginIdx = commands.findIndex(
                c => c.command === 'az' && c.args.includes('login') && c.args.includes('acr')
            );
            const firstDockerIdx = commands.findIndex(c => c.command === 'docker');

            expect(acrCreateIdx).toBeGreaterThanOrEqual(0);
            expect(acrLoginIdx).toBeGreaterThan(acrCreateIdx);
            expect(firstDockerIdx).toBeGreaterThan(acrLoginIdx);
        });
    });
});
