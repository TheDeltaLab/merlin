/**
 * Transformer unit tests
 */

import { describe, test, expect } from 'vitest';
import { expand } from '../transformer.js';
import { createResourceYAML, createMultiRingResource, createMultiRegionResource } from '../../test-utils/factories.js';

describe('Transformer', () => {
    describe('expand', () => {
        describe('Ring/Region Expansion', () => {
            test('should expand single ring without region', () => {
                const resource = createResourceYAML({
                    name: 'myres',
                    ring: 'test',
                    region: undefined
                });

                const expanded = expand(resource);

                expect(expanded).toHaveLength(1);
                expect(expanded[0]).toMatchObject({
                    name: 'myres',
                    ring: 'test',
                    region: undefined
                });
            });

            test('should expand single ring with single region', () => {
                const resource = createResourceYAML({
                    name: 'myres',
                    ring: 'test',
                    region: 'eastus'
                });

                const expanded = expand(resource);

                expect(expanded).toHaveLength(1);
                expect(expanded[0]).toMatchObject({
                    name: 'myres',
                    ring: 'test',
                    region: 'eastus'
                });
            });

            test('should expand multiple rings without region', () => {
                const resource = createMultiRingResource(['test', 'staging']);

                const expanded = expand(resource);

                expect(expanded).toHaveLength(2);
                expect(expanded[0].ring).toBe('test');
                expect(expanded[1].ring).toBe('staging');
                expect(expanded[0].region).toBeUndefined();
                expect(expanded[1].region).toBeUndefined();
            });

            test('should expand multiple rings with single region', () => {
                const resource = createResourceYAML({
                    ring: ['test', 'staging'],
                    region: 'eastus'
                });

                const expanded = expand(resource);

                expect(expanded).toHaveLength(2);
                expect(expanded).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ ring: 'test', region: 'eastus' }),
                        expect.objectContaining({ ring: 'staging', region: 'eastus' })
                    ])
                );
            });

            test('should expand single ring with multiple regions', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    region: ['eastus', 'westus']
                });

                const expanded = expand(resource);

                expect(expanded).toHaveLength(2);
                expect(expanded).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ ring: 'test', region: 'eastus' }),
                        expect.objectContaining({ ring: 'test', region: 'westus' })
                    ])
                );
            });

            test('should expand cartesian product of rings and regions', () => {
                const resource = createMultiRegionResource(['test', 'staging'], ['eastus', 'westus']);

                const expanded = expand(resource);

                expect(expanded).toHaveLength(4);
                expect(expanded).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ ring: 'test', region: 'eastus' }),
                        expect.objectContaining({ ring: 'test', region: 'westus' }),
                        expect.objectContaining({ ring: 'staging', region: 'eastus' }),
                        expect.objectContaining({ ring: 'staging', region: 'westus' })
                    ])
                );
            });

            test('should expand 3 rings with 2 regions into 6 resources', () => {
                const resource = createMultiRegionResource(
                    ['test', 'staging', 'production'],
                    ['eastus', 'westus']
                );

                const expanded = expand(resource);

                expect(expanded).toHaveLength(6);
            });

            test('should handle undefined region', () => {
                const resource = createResourceYAML({
                    ring: ['test', 'staging'],
                    region: undefined
                });

                const expanded = expand(resource);

                expect(expanded).toHaveLength(2);
                expanded.forEach(r => expect(r.region).toBeUndefined());
            });
        });

        describe('Config Merging', () => {
            test('should use defaultConfig when no specificConfig matches', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        tier: 'basic',
                        replicas: 1
                    },
                    specificConfig: []
                });

                const expanded = expand(resource);

                expect(expanded[0].config).toEqual({
                    tier: 'basic',
                    replicas: 1
                });
            });

            test('should merge ring-specific config', () => {
                const resource = createResourceYAML({
                    ring: ['test', 'staging'],
                    defaultConfig: {
                        tier: 'basic',
                        replicas: 1
                    },
                    specificConfig: [
                        { ring: 'staging', tier: 'premium', replicas: 3 }
                    ]
                });

                const expanded = expand(resource);

                const testResource = expanded.find(r => r.ring === 'test');
                const stagingResource = expanded.find(r => r.ring === 'staging');

                expect(testResource?.config).toEqual({
                    tier: 'basic',
                    replicas: 1
                });

                expect(stagingResource?.config).toEqual({
                    tier: 'premium',
                    replicas: 3
                });
            });

            test('should merge region-specific config', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    region: ['eastus', 'westus'],
                    defaultConfig: {
                        endpoint: 'default.com'
                    },
                    specificConfig: [
                        { region: 'eastus', endpoint: 'eastus.com' }
                    ]
                });

                const expanded = expand(resource);

                const eastusResource = expanded.find(r => r.region === 'eastus');
                const westusResource = expanded.find(r => r.region === 'westus');

                expect(eastusResource?.config).toEqual({
                    endpoint: 'eastus.com'
                });

                expect(westusResource?.config).toEqual({
                    endpoint: 'default.com'
                });
            });

            test('should merge ring+region specific config', () => {
                const resource = createResourceYAML({
                    ring: ['test', 'staging'],
                    region: ['eastus', 'westus'],
                    defaultConfig: {
                        tier: 'basic'
                    },
                    specificConfig: [
                        { ring: 'staging', tier: 'premium' },
                        { ring: 'staging', region: 'eastus', tier: 'ultra' }
                    ]
                });

                const expanded = expand(resource);

                const stagingEastus = expanded.find(r => r.ring === 'staging' && r.region === 'eastus');
                const stagingWestus = expanded.find(r => r.ring === 'staging' && r.region === 'westus');
                const testEastus = expanded.find(r => r.ring === 'test' && r.region === 'eastus');

                expect(stagingEastus?.config.tier).toBe('ultra');
                expect(stagingWestus?.config.tier).toBe('premium');
                expect(testEastus?.config.tier).toBe('basic');
            });

            test('should apply multiple matching specificConfigs in order', () => {
                const resource = createResourceYAML({
                    ring: 'staging',
                    region: 'eastus',
                    defaultConfig: {
                        a: 1,
                        b: 2,
                        c: 3
                    },
                    specificConfig: [
                        { ring: 'staging', a: 10, b: 20 },
                        { region: 'eastus', b: 200, c: 300 }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config).toEqual({
                    a: 10,
                    b: 200,
                    c: 300
                });
            });

            test('should exclude ring and region from merged config', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    region: 'eastus',
                    defaultConfig: {},
                    specificConfig: [
                        { ring: 'test', region: 'eastus', value: 'test' }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config).not.toHaveProperty('ring');
                expect(expanded[0].config).not.toHaveProperty('region');
                expect(expanded[0].config).toHaveProperty('value');
            });
        });

        describe('Deep Merge Behavior', () => {
            test('should deep merge nested objects', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        database: {
                            host: 'localhost',
                            port: 5432,
                            ssl: false
                        }
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            database: {
                                port: 3306,
                                ssl: true
                            }
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config).toEqual({
                    database: {
                        host: 'localhost',
                        port: 3306,
                        ssl: true
                    }
                });
            });

            test('should override primitives completely', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        tier: 'basic',
                        count: 1
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            tier: 'premium',
                            count: 5
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config.tier).toBe('premium');
                expect(expanded[0].config.count).toBe(5);
            });

            test('should override arrays completely, not merge', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        allowedIps: ['192.168.1.1', '192.168.1.2']
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            allowedIps: ['10.0.0.1']
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config.allowedIps).toEqual(['10.0.0.1']);
            });

            test('should handle undefined values', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        a: 1,
                        b: 2
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            a: undefined,
                            c: 3
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config).toHaveProperty('a');
                expect(expanded[0].config.a).toBe(1);
                expect(expanded[0].config).toHaveProperty('c');
            });

            test('should handle null values', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        value: 'test'
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            value: null
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config.value).toBeNull();
            });

            test('should handle complex nested structures', () => {
                const resource = createResourceYAML({
                    ring: 'test',
                    defaultConfig: {
                        level1: {
                            level2: {
                                level3: {
                                    a: 1,
                                    b: 2
                                }
                            }
                        }
                    },
                    specificConfig: [
                        {
                            ring: 'test',
                            level1: {
                                level2: {
                                    level3: {
                                        b: 20,
                                        c: 30
                                    }
                                }
                            }
                        }
                    ]
                });

                const expanded = expand(resource);

                expect(expanded[0].config).toEqual({
                    level1: {
                        level2: {
                            level3: {
                                a: 1,
                                b: 20,
                                c: 30
                            }
                        }
                    }
                });
            });
        });

        describe('AuthProvider Conversion', () => {
            test('should convert string authProvider', () => {
                const resource = createResourceYAML({
                    authProvider: 'simpleAuth'
                });

                const expanded = expand(resource);

                expect(expanded[0].authProvider).toEqual({
                    name: 'simpleAuth',
                    args: {}
                });
            });

            test('should convert object authProvider with args', () => {
                const resource = createResourceYAML({
                    authProvider: {
                        name: 'complexAuth',
                        role: 'admin',
                        scope: 'resource'
                    }
                });

                const expanded = expand(resource);

                expect(expanded[0].authProvider).toEqual({
                    name: 'complexAuth',
                    args: {
                        role: 'admin',
                        scope: 'resource'
                    }
                });
            });

            test('should preserve authProvider name and args', () => {
                const resource = createResourceYAML({
                    authProvider: {
                        name: 'azureAuth',
                        tenantId: '123',
                        clientId: '456'
                    }
                });

                const expanded = expand(resource);

                expect(expanded[0].authProvider.name).toBe('azureAuth');
                expect(expanded[0].authProvider.args).toEqual({
                    tenantId: '123',
                    clientId: '456'
                });
            });
        });

        describe('Exports Conversion', () => {
            test('should convert string export', () => {
                const resource = createResourceYAML({
                    exports: {
                        connectionString: 'getConnectionString'
                    }
                });

                const expanded = expand(resource);

                expect(expanded[0].exports.connectionString).toEqual({
                    name: 'getConnectionString',
                    args: {}
                });
            });

            test('should convert object export with args', () => {
                const resource = createResourceYAML({
                    exports: {
                        endpoint: {
                            name: 'getEndpoint',
                            protocol: 'https',
                            port: '443'
                        }
                    }
                });

                const expanded = expand(resource);

                expect(expanded[0].exports.endpoint).toEqual({
                    name: 'getEndpoint',
                    args: {
                        protocol: 'https',
                        port: '443'
                    }
                });
            });

            test('should handle empty exports', () => {
                const resource = createResourceYAML({
                    exports: {}
                });

                const expanded = expand(resource);

                expect(expanded[0].exports).toEqual({});
            });

            test('should handle multiple exports', () => {
                const resource = createResourceYAML({
                    exports: {
                        connectionString: 'getConnectionString',
                        endpoint: {
                            name: 'getEndpoint',
                            protocol: 'https'
                        },
                        apiKey: 'getApiKey'
                    }
                });

                const expanded = expand(resource);

                expect(Object.keys(expanded[0].exports)).toHaveLength(3);
                expect(expanded[0].exports.connectionString.name).toBe('getConnectionString');
                expect(expanded[0].exports.endpoint.name).toBe('getEndpoint');
                expect(expanded[0].exports.apiKey.name).toBe('getApiKey');
            });
        });
    });
});

// ── Additional tests for parameter interpolation ───────────────────────────

import { isParamValue } from '../../compiler/types.js';

describe('Transformer - Parameter Interpolation', () => {
    describe('Config parsing after deepMerge', () => {
        test('wraps parameterized string in defaultConfig as ParamValue', () => {
            const resource = createResourceYAML({
                defaultConfig: {
                    image: '${ AzureContainerRegistry.acr.server }/myapp:latest'
                },
                dependencies: [{ resource: 'AzureContainerRegistry.acr', isHardDependency: true }],
                specificConfig: []
            });

            const expanded = expand(resource);
            expect(isParamValue(expanded[0].config.image)).toBe(true);
        });

        test('leaves plain string in config as-is', () => {
            const resource = createResourceYAML({
                defaultConfig: {
                    containerName: 'myapp',
                    cpu: 0.5
                },
                specificConfig: []
            });

            const expanded = expand(resource);
            expect(expanded[0].config.containerName).toBe('myapp');
            expect(expanded[0].config.cpu).toBe(0.5);
        });

        test('parses ${ this.ring } expression in config', () => {
            const resource = createResourceYAML({
                ring: 'staging',
                defaultConfig: {
                    envVar: '${ this.ring }'
                },
                specificConfig: []
            });

            const expanded = expand(resource);
            const config = expanded.find(r => r.ring === 'staging')!.config;
            expect(isParamValue(config.envVar)).toBe(true);

            const param = config.envVar as any;
            expect(param.segments).toHaveLength(1);
            expect(param.segments[0]).toEqual({ type: 'self', field: 'ring' });
        });

        test('parses parameters in array config values', () => {
            const resource = createResourceYAML({
                defaultConfig: {
                    envVars: [
                        'APP_ENV=${ this.ring }',
                        'PLAIN=value'
                    ]
                },
                specificConfig: []
            });

            const expanded = expand(resource);
            const envVars = expanded[0].config.envVars as unknown[];
            expect(isParamValue(envVars[0])).toBe(true);
            expect(envVars[1]).toBe('PLAIN=value');
        });

        test('parses parameters in nested config objects', () => {
            const resource = createResourceYAML({
                defaultConfig: {
                    tags: {
                        merlin: 'true',
                        env: '${ this.ring }'
                    }
                },
                specificConfig: []
            });

            const expanded = expand(resource);
            const tags = expanded[0].config.tags as Record<string, unknown>;
            expect(tags.merlin).toBe('true');
            expect(isParamValue(tags.env)).toBe(true);
        });

        test('parses params applied AFTER deepMerge (specificConfig merge first)', () => {
            // specificConfig overrides the parameterized image — result should still be a ParamValue
            const resource = createResourceYAML({
                ring: ['staging', 'test'],
                defaultConfig: {
                    image: '${ AzureContainerRegistry.acr.server }/myapp:latest',
                    cpu: 0.5
                },
                dependencies: [{ resource: 'AzureContainerRegistry.acr', isHardDependency: true }],
                specificConfig: [
                    { ring: 'staging', cpu: 1 }
                ]
            });

            const expanded = expand(resource);
            const staging = expanded.find(r => r.ring === 'staging')!;
            const test_ = expanded.find(r => r.ring === 'test')!;

            // image is a ParamValue for both rings
            expect(isParamValue(staging.config.image)).toBe(true);
            expect(isParamValue(test_.config.image)).toBe(true);

            // cpu is overridden for staging
            expect(staging.config.cpu).toBe(1);
            expect(test_.config.cpu).toBe(0.5);
        });
    });
});
