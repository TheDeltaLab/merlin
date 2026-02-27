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

beforeEach(() => {
    clearRegistry();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
    describe('Literal segments', () => {
        test('resolves plain string (no ParamValue) unchanged', async () => {
            const resource = makeResource({ config: { image: 'myapp:latest' } });
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).image).toBe('myapp:latest');
            expect(captureCommands).toHaveLength(0);
        });

        test('resolves number values unchanged', async () => {
            const resource = makeResource({ config: { cpu: 0.5, replicas: 3 } });
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).cpu).toBe(0.5);
            expect((resolved.config as any).replicas).toBe(3);
            expect(captureCommands).toHaveLength(0);
        });

        test('resolves boolean values unchanged', async () => {
            const resource = makeResource({ config: { httpsOnly: true } });
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).httpsOnly).toBe(true);
            expect(captureCommands).toHaveLength(0);
        });

        test('resolves null values unchanged', async () => {
            const resource = makeResource({ config: { value: null } });
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).value).toBeNull();
            expect(captureCommands).toHaveLength(0);
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
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).envVar).toBe('staging');
            expect(captureCommands).toHaveLength(0);
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
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).envVar).toBe('APP_ENV=test');
            expect(captureCommands).toHaveLength(0);
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
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).regionVal).toBe('eastasia');
            expect(captureCommands).toHaveLength(0);
        });

        test('resolves self.region to empty string when region is undefined', async () => {
            const resource = makeResource({
                region: undefined,
                config: {
                    regionVal: makeParamValue([{ type: 'self', field: 'region' }])
                }
            });
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            expect((resolved.config as any).regionVal).toBe('');
            expect(captureCommands).toHaveLength(0);
        });
    });

    describe('${ dep.export } resolution', () => {
        test('resolves dep segment to $VARNAME and collects a capture command', async () => {
            // Setup a getter
            const mockGetter: ProprietyGetter = {
                name: 'testGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'az',
                    args: ['acr', 'show', '-g', 'rg', '-n', 'myregistry', '-o', 'json'],
                    resultParser: (out: string) => JSON.parse(out).loginServer
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

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Config value should be a shell variable reference
            expect((resolved.config as any).image).toBe('$MERLIN_CHUANGACR_SERVER/myapp:latest');

            // Should have produced exactly one capture command
            expect(captureCommands).toHaveLength(1);
            const captureCmd = captureCommands[0];
            expect(captureCmd.envCapture).toBe('MERLIN_CHUANGACR_SERVER');
            expect(captureCmd.command).toBe('az');
            expect(captureCmd.args).toEqual(['acr', 'show', '-g', 'rg', '-n', 'myregistry', '-o', 'json']);
            // resultParser should be preserved for execute mode
            expect(typeof captureCmd.resultParser).toBe('function');
        });

        test('deduplicates capture commands when same export is referenced multiple times', async () => {
            const mockGetter: ProprietyGetter = {
                name: 'acrServerGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'az',
                    args: ['acr', 'show', '-g', 'rg', '-n', 'reg', '-o', 'json']
                }] as Command[])
            };
            registerProprietyGetter(mockGetter);

            const depResource = makeResource({
                name: 'chuangacr',
                ring: 'staging',
                region: 'eastasia',
                exports: {
                    server: { getter: mockGetter, args: {} }
                }
            });
            registerResource(depResource);

            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                config: {
                    // Same export referenced twice
                    image: makeParamValue([
                        { type: 'dep', resource: 'chuangacr', export: 'server' },
                        { type: 'literal', value: '/myapp:latest' }
                    ]),
                    registryServer: makeParamValue([
                        { type: 'dep', resource: 'chuangacr', export: 'server' }
                    ])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Both config values reference the same variable
            expect((resolved.config as any).image).toBe('$MERLIN_CHUANGACR_SERVER/myapp:latest');
            expect((resolved.config as any).registryServer).toBe('$MERLIN_CHUANGACR_SERVER');

            // Only ONE capture command despite two references
            expect(captureCommands).toHaveLength(1);
            expect(captureCommands[0].envCapture).toBe('MERLIN_CHUANGACR_SERVER');
        });

        test('uses plain stdout capture when getter has no resultParser', async () => {
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

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Variable reference substituted
            expect((resolved.config as any).storageAcct).toBe('STORAGE_ACCOUNT=$MERLIN_MYRESOURCE_NAME');

            // Capture command has no resultParser
            expect(captureCommands).toHaveLength(1);
            expect(captureCommands[0].envCapture).toBe('MERLIN_MYRESOURCE_NAME');
            expect(captureCommands[0].command).toBe('echo');
            expect(captureCommands[0].resultParser).toBeUndefined();
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

        test('multiple different exports produce multiple capture commands', async () => {
            const acrGetter: ProprietyGetter = {
                name: 'acrGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'az', args: ['acr', 'show']
                }] as Command[])
            };
            const nameGetter: ProprietyGetter = {
                name: 'nameGetter',
                dependencies: [],
                get: vi.fn().mockResolvedValue([{
                    command: 'echo', args: ['abs-name']
                }] as Command[])
            };

            const acrResource = makeResource({
                name: 'chuangacr',
                ring: 'staging',
                region: 'eastasia',
                exports: { server: { getter: acrGetter, args: {} } }
            });
            const absResource = makeResource({
                name: 'chuangabs',
                ring: 'staging',
                region: 'eastasia',
                exports: { name: { getter: nameGetter, args: {} } }
            });
            registerResource(acrResource);
            registerResource(absResource);

            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                config: {
                    image: makeParamValue([{ type: 'dep', resource: 'chuangacr', export: 'server' }]),
                    storage: makeParamValue([{ type: 'dep', resource: 'chuangabs', export: 'name' }])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            expect((resolved.config as any).image).toBe('$MERLIN_CHUANGACR_SERVER');
            expect((resolved.config as any).storage).toBe('$MERLIN_CHUANGABS_NAME');
            expect(captureCommands).toHaveLength(2);
            const varNames = captureCommands.map(c => c.envCapture);
            expect(varNames).toContain('MERLIN_CHUANGACR_SERVER');
            expect(varNames).toContain('MERLIN_CHUANGABS_NAME');
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
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            const envVars = (resolved.config as any).envVars as string[];
            expect(envVars[0]).toBe('APP_ENV=test');
            expect(envVars[1]).toBe('PLAIN=value');
            expect(captureCommands).toHaveLength(0);
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
            const { resource: resolved, captureCommands } = await resolveConfig(resource);
            const tags = (resolved.config as any).tags;
            expect(tags.merlin).toBe('true');
            expect(tags.env).toBe('production');
            expect(captureCommands).toHaveLength(0);
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
