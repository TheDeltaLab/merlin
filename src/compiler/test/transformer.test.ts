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
