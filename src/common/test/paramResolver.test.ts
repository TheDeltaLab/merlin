/**
 * Unit tests for runtime parameter resolver
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resolveConfig } from '../paramResolver.js';
import { clearRegistry, registerResource } from '../registry.js';
import { Resource, registerProprietyGetter, ProprietyGetter, Dependency, Command } from '../resource.js';
import { ParamValue } from '../../compiler/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeParamValue(segments: ParamValue['segments']): ParamValue {
    return { __merlin_param__: true, segments };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
    return {
        name: 'test-resource',
        ring: 'staging',
        region: 'eastasia',
        type: 'TestType',
        authProvider: {
            provider: { name: 'testAuth', apply: vi.fn(), dependencies: [] },
            args: {}
        },
        dependencies: [],
        config: {},
        exports: {},
        ...overrides
    };
}

// Mock for execa — intercept shell execution
vi.mock('execa', () => ({
    execa: vi.fn().mockResolvedValue({ stdout: 'mock-stdout' })
}));

import { execa } from 'execa';
const mockedExeca = vi.mocked(execa);

beforeEach(() => {
    clearRegistry();
    mockedExeca.mockReset();
    mockedExeca.mockResolvedValue({ stdout: 'mock-stdout' } as any);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
    describe('Literal segments', () => {
        test('resolves plain string (no ParamValue) unchanged', async () => {
            const resource = makeResource({ config: { image: 'myapp:latest' } });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).image).toBe('myapp:latest');
        });

        test('resolves number values unchanged', async () => {
            const resource = makeResource({ config: { cpu: 0.5, replicas: 3 } });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).cpu).toBe(0.5);
            expect((resolved.config as any).replicas).toBe(3);
        });

        test('resolves boolean values unchanged', async () => {
            const resource = makeResource({ config: { httpsOnly: true } });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).httpsOnly).toBe(true);
        });

        test('resolves null values unchanged', async () => {
            const resource = makeResource({ config: { value: null } });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).value).toBeNull();
        });
    });

    describe('${ this.ring } resolution', () => {
        test('resolves self.ring to resource.ring', async () => {
            const resource = makeResource({
                ring: 'staging',
                config: {
                    envVar: makeParamValue([{ type: 'self', field: 'ring' }])
                }
            });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).envVar).toBe('staging');
        });

        test('resolves ring with prefix', async () => {
            const resource = makeResource({
                ring: 'test',
                config: {
                    envVar: makeParamValue([
                        { type: 'literal', value: 'APP_ENV=' },
                        { type: 'self', field: 'ring' }
                    ])
                }
            });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).envVar).toBe('APP_ENV=test');
        });
    });

    describe('${ this.region } resolution', () => {
        test('resolves self.region to resource.region', async () => {
            const resource = makeResource({
                region: 'eastasia',
                config: {
                    regionVal: makeParamValue([{ type: 'self', field: 'region' }])
                }
            });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).regionVal).toBe('eastasia');
        });

        test('resolves self.region to empty string when region is undefined', async () => {
            const resource = makeResource({
                region: undefined,
                config: {
                    regionVal: makeParamValue([{ type: 'self', field: 'region' }])
                }
            });
            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).regionVal).toBe('');
        });
    });

    describe('${ dep.export } resolution', () => {
        test('resolves dep segment using ProprietyGetter commands', async () => {
            // Setup a getter that returns a fixed value
            const mockGetter: ProprietyGetter = {
                name: 'testGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'echo',
                    args: ['my-registry.azurecr.io'],
                    resultParser: (out: string) => out.trim()
                }] as Command[])
            };
            registerProprietyGetter(mockGetter);

            // Register the dependency resource
            const depResource = makeResource({
                name: 'chuangacr',
                ring: 'staging',
                region: 'eastasia',
                exports: {
                    server: { getter: mockGetter, args: {} }
                }
            });
            registerResource(depResource);

            // Create the requesting resource
            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                dependencies: [{ resource: 'chuangacr', isHardDependency: true }],
                config: {
                    image: makeParamValue([
                        { type: 'dep', resource: 'chuangacr', export: 'server' },
                        { type: 'literal', value: '/myapp:latest' }
                    ])
                }
            });

            mockedExeca.mockResolvedValue({ stdout: 'my-registry.azurecr.io' } as any);

            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).image).toBe('my-registry.azurecr.io/myapp:latest');
        });

        test('uses stdout directly when getter has no resultParser', async () => {
            // AzureResourceNameGetter uses `echo` with no resultParser
            const mockGetter: ProprietyGetter = {
                name: 'echoGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'echo',
                    args: ['resource-name-value']
                    // No resultParser
                }] as Command[])
            };
            registerProprietyGetter(mockGetter);

            const depResource = makeResource({
                name: 'myresource',
                ring: 'staging',
                region: 'eastasia',
                exports: { name: { getter: mockGetter, args: {} } }
            });
            registerResource(depResource);

            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                dependencies: [{ resource: 'myresource' }],
                config: {
                    storageAcct: makeParamValue([
                        { type: 'literal', value: 'STORAGE_ACCOUNT=' },
                        { type: 'dep', resource: 'myresource', export: 'name' }
                    ])
                }
            });

            mockedExeca.mockResolvedValue({ stdout: 'resource-name-value' } as any);

            const resolved = await resolveConfig(resource);
            expect((resolved.config as any).storageAcct).toBe('STORAGE_ACCOUNT=resource-name-value');
        });

        test('throws when dep resource not found in registry', async () => {
            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                dependencies: [{ resource: 'missing-resource' }],
                config: {
                    val: makeParamValue([
                        { type: 'dep', resource: 'missing-resource', export: 'server' }
                    ])
                }
            });

            await expect(resolveConfig(resource)).rejects.toThrow('no resource named "missing-resource"');
        });

        test('throws when dep export not found on resource', async () => {
            const depResource = makeResource({
                name: 'myresource',
                ring: 'staging',
                region: 'eastasia',
                exports: {} // no exports
            });
            registerResource(depResource);

            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                dependencies: [{ resource: 'myresource' }],
                config: {
                    val: makeParamValue([
                        { type: 'dep', resource: 'myresource', export: 'nonexistent' }
                    ])
                }
            });

            await expect(resolveConfig(resource)).rejects.toThrow('does not have an export named "nonexistent"');
        });
    });

    describe('Complex config structures', () => {
        test('resolves ParamValues inside arrays', async () => {
            const resource = makeResource({
                ring: 'test',
                config: {
                    envVars: [
                        makeParamValue([
                            { type: 'literal', value: 'APP_ENV=' },
                            { type: 'self', field: 'ring' }
                        ]),
                        'PLAIN=value'
                    ]
                }
            });
            const resolved = await resolveConfig(resource);
            const envVars = (resolved.config as any).envVars as string[];
            expect(envVars[0]).toBe('APP_ENV=test');
            expect(envVars[1]).toBe('PLAIN=value');
        });

        test('resolves ParamValues inside nested objects', async () => {
            const resource = makeResource({
                ring: 'production',
                config: {
                    tags: {
                        merlin: 'true',
                        env: makeParamValue([{ type: 'self', field: 'ring' }])
                    }
                }
            });
            const resolved = await resolveConfig(resource);
            const tags = (resolved.config as any).tags;
            expect(tags.merlin).toBe('true');
            expect(tags.env).toBe('production');
        });

        test('does not mutate the original resource', async () => {
            const originalConfig = {
                env: makeParamValue([{ type: 'self', field: 'ring' }])
            };
            const resource = makeResource({ ring: 'test', config: originalConfig });
            await resolveConfig(resource);
            // Original config still has ParamValue
            expect(typeof originalConfig.env).toBe('object');
            expect((originalConfig.env as ParamValue).__merlin_param__).toBe(true);
        });
    });
});
