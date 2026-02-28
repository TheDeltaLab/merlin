/**
 * Unit tests for runtime parameter resolver
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resolveConfig } from '../paramResolver.js';
import { clearRegistry, registerResource, getResource } from '../registry.js';
import { Resource, registerProprietyGetter, ProprietyGetter, Dependency, Command, registerRender, Render } from '../resource.js';
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
                    args: ['acr', 'show', '-g', 'rg', '-n', 'myregistry', '-o', 'tsv', '--query', 'loginServer'],
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
                        { type: 'dep', resourceType: 'TestType', resource: 'chuangacr', export: 'server' },
                        { type: 'literal', value: '/myapp:latest' }
                    ])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Config value should be a shell variable reference
            expect((resolved.config as any).image).toBe('$MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER/myapp:latest');

            // Should have produced exactly one capture command
            expect(captureCommands).toHaveLength(1);
            const captureCmd = captureCommands[0];
            expect(captureCmd.envCapture).toBe('MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER');
            expect(captureCmd.command).toBe('az');
            expect(captureCmd.args).toEqual(['acr', 'show', '-g', 'rg', '-n', 'myregistry', '-o', 'tsv', '--query', 'loginServer']);
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
                        { type: 'dep', resourceType: 'TestType', resource: 'chuangacr', export: 'server' },
                        { type: 'literal', value: '/myapp:latest' }
                    ]),
                    registryServer: makeParamValue([
                        { type: 'dep', resourceType: 'TestType', resource: 'chuangacr', export: 'server' }
                    ])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Both config values reference the same variable
            expect((resolved.config as any).image).toBe('$MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER/myapp:latest');
            expect((resolved.config as any).registryServer).toBe('$MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER');

            // Only ONE capture command despite two references
            expect(captureCommands).toHaveLength(1);
            expect(captureCommands[0].envCapture).toBe('MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER');
        });

        test('captures plain stdout from getter command', async () => {
            // AzureResourceNameGetter uses `echo` to output the resource name directly
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
                        { type: 'dep', resourceType: 'TestType', resource: 'myresource', export: 'name' }
                    ])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            // Variable reference substituted
            expect((resolved.config as any).storageAcct).toBe('STORAGE_ACCOUNT=$MERLIN_TESTTYPE_MYRESOURCE_STG_EAS_NAME');

            expect(captureCommands).toHaveLength(1);
            expect(captureCommands[0].envCapture).toBe('MERLIN_TESTTYPE_MYRESOURCE_STG_EAS_NAME');
            expect(captureCommands[0].command).toBe('echo');
        });

        test('throws when dep resource not found in registry', async () => {
            const resource = makeResource({
                ring: 'staging',
                region: 'eastasia',
                dependencies: [{ resource: 'missing-resource' }],
                config: {
                    val: makeParamValue([
                        { type: 'dep', resourceType: 'TestType', resource: 'missing-resource', export: 'server' }
                    ])
                }
            });

            await expect(resolveConfig(resource)).rejects.toThrow('no resource "TestType.missing-resource"');
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
                        { type: 'dep', resourceType: 'TestType', resource: 'myresource', export: 'nonexistent' }
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
                    image: makeParamValue([{ type: 'dep', resourceType: 'TestType', resource: 'chuangacr', export: 'server' }]),
                    storage: makeParamValue([{ type: 'dep', resourceType: 'TestType', resource: 'chuangabs', export: 'name' }])
                }
            });

            const { resource: resolved, captureCommands } = await resolveConfig(resource);

            expect((resolved.config as any).image).toBe('$MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER');
            expect((resolved.config as any).storage).toBe('$MERLIN_TESTTYPE_CHUANGABS_STG_EAS_NAME');
            expect(captureCommands).toHaveLength(2);
            const varNames = captureCommands.map(c => c.envCapture);
            expect(varNames).toContain('MERLIN_TESTTYPE_CHUANGACR_STG_EAS_SERVER');
            expect(varNames).toContain('MERLIN_TESTTYPE_CHUANGABS_STG_EAS_NAME');
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

// ── Registry: global resource lookup ───────────────────────────────────────

describe('getResource — global resource lookup', () => {
    beforeEach(() => {
        clearRegistry();
    });

    function makeGlobalResource(overrides: Partial<Resource> = {}): Resource {
        return {
            name: 'globalres',
            ring: 'staging',
            region: undefined,   // registered without region
            type: 'GlobalType',
            isGlobalResource: true,
            dependencies: [],
            config: {},
            exports: {},
            ...overrides,
        };
    }

    test('finds a global resource when caller provides a region', () => {
        const res = makeGlobalResource();
        registerResource(res);
        // Caller is in eastasia, but globalres has no region
        const found = getResource('GlobalType', 'globalres', 'staging', 'eastasia');
        expect(found).toBeDefined();
        expect(found!.isGlobalResource).toBe(true);
    });

    test('finds a global resource when caller provides a different region', () => {
        const res = makeGlobalResource();
        registerResource(res);
        const found = getResource('GlobalType', 'globalres', 'staging', 'koreacentral');
        expect(found).toBeDefined();
    });

    test('still finds a global resource by exact key (no region supplied)', () => {
        const res = makeGlobalResource();
        registerResource(res);
        const found = getResource('GlobalType', 'globalres', 'staging');
        expect(found).toBeDefined();
    });

    test('does NOT return a non-global resource via region-less fallback', () => {
        // A regular resource registered without region should NOT match
        // a caller that passes a region, unless it is marked as global.
        const res: Resource = {
            name: 'normalres',
            ring: 'staging',
            region: undefined,
            type: 'NormalType',
            isGlobalResource: false,
            dependencies: [],
            config: {},
            exports: {},
        };
        registerResource(res);
        // Exact key (no region) still works
        expect(getResource('NormalType', 'normalres', 'staging')).toBeDefined();
        // With region → should NOT fall back to non-global
        expect(getResource('NormalType', 'normalres', 'staging', 'eastasia')).toBeUndefined();
    });

    test('resolveConfig resolves a dep on a global resource from a regional resource', async () => {
        const mockGetter: ProprietyGetter = {
            name: 'dnsNameGetter',
            dependencies: [],
            get: vi.fn().mockResolvedValue([{ command: 'echo', args: ['chuang.staging.example.com'] }] as Command[]),
        };
        registerProprietyGetter(mockGetter);

        // Register a global DNS-zone-like resource (no region)
        const globalRes = makeGlobalResource({
            name: 'chuangdns',
            exports: { domainName: { getter: mockGetter, args: {} } },
        });
        registerResource(globalRes);

        // A regional container-app resource that depends on the global resource
        const caResource = makeResource({
            ring: 'staging',
            region: 'eastasia',
            dependencies: [{ resource: 'chuangdns', isHardDependency: false }],
            config: {
                dnsZone: makeParamValue([{ type: 'dep', resourceType: 'GlobalType', resource: 'chuangdns', export: 'domainName' }]),
            },
        });

        const { resource: resolved, captureCommands } = await resolveConfig(caResource);
        expect((resolved.config as any).dnsZone).toBe('$MERLIN_GLOBALTYPE_CHUANGDNS_STG_EAS_DOMAINNAME');
        expect(captureCommands).toHaveLength(1);
        expect(captureCommands[0].envCapture).toBe('MERLIN_GLOBALTYPE_CHUANGDNS_STG_EAS_DOMAINNAME');
    });
});
