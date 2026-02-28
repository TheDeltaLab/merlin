/**
 * Generator unit tests
 */

import { describe, test, expect } from 'vitest';
import { generate, generateIndex } from '../generator.js';
import { createExpandedResource } from '../../test-utils/factories.js';
import { normalizeGeneratedCode } from '../../test-utils/helpers.js';

describe('Generator', () => {
    describe('generate', () => {
        describe('Code Generation', () => {
            test('should generate valid TypeScript', () => {
                const resources = [createExpandedResource()];
                const result = generate('/test/source.yml', resources);

                expect(result.fileName).toBe('source.ts');
                expect(result.content).toContain('import { Resource');
                expect(result.content).toContain('registerResource');
                expect(result.content).toContain('export const');
                expect(result.content).toContain('registerResource(');
            });

            test('should include proper imports', () => {
                const resources = [createExpandedResource()];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('import { Resource, getAuthProvider, getProprietyGetter, registerResource }');
            });

            test('should generate resource variable names', () => {
                const resources = [createExpandedResource({ name: 'myres', ring: 'test' })];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('export const TestType_myres_test: Resource');
            });

            test('should generate Resource objects', () => {
                const resources = [createExpandedResource()];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toMatch(/export const [\w-]+: Resource = \{/);
                expect(result.content).toContain('name:');
                expect(result.content).toContain('ring:');
                expect(result.content).toContain('type:');
            });

            test('should call registerResource', () => {
                const resources = [createExpandedResource({ name: 'testres', ring: 'staging' })];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('registerResource(TestType_testres_staging)');
            });

            test('should add source comment', () => {
                const resources = [createExpandedResource()];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('// Source: /test/source.yml');
            });
        });

        describe('Resource Naming', () => {
            test('should name resource with ring only', () => {
                const resource = createExpandedResource({
                    name: 'myres',
                    ring: 'staging',
                    region: undefined
                });
                const result = generate('/test/a.yml', [resource]);

                expect(result.content).toContain('TestType_myres_staging');
                expect(result.resources).toContain('TestType_myres_staging');
            });

            test('should name resource with ring and region', () => {
                const resource = createExpandedResource({
                    name: 'myres',
                    ring: 'staging',
                    region: 'eastus'
                });
                const result = generate('/test/a.yml', [resource]);

                expect(result.content).toContain('TestType_myres_staging_eastus');
                expect(result.resources).toContain('TestType_myres_staging_eastus');
            });

            test('should handle resource names with hyphens', () => {
                const resource = createExpandedResource({
                    name: 'my-resource',
                    ring: 'test'
                });
                const result = generate('/test/a.yml', [resource]);

                expect(result.content).toContain('TestType_my-resource_test');
            });
        });

        describe('Resource Object Generation', () => {
            test('should generate all required fields', () => {
                const resource = createExpandedResource();
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('name:');
                expect(result.content).toContain('ring:');
                expect(result.content).toContain('type:');
                expect(result.content).toContain('authProvider:');
                expect(result.content).toContain('dependencies:');
                expect(result.content).toContain('config:');
                expect(result.content).toContain('exports:');
            });

            test('should include optional fields when present', () => {
                const resource = createExpandedResource({
                    region: 'eastus',
                    project: 'my-project',
                    parent: 'parent-resource'
                });
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('region: "eastus"');
                expect(result.content).toContain('project: "my-project"');
                expect(result.content).toContain('parent: "parent-resource"');
            });

            test('should format authProvider with getAuthProvider', () => {
                const resource = createExpandedResource({
                    authProvider: { name: 'azureAD', args: { tenantId: '123' } }
                });
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('authProvider: {');
                expect(result.content).toContain('provider: getAuthProvider("azureAD")');
                expect(result.content).toContain('args: {"tenantId":"123"}');
            });

            test('should format exports with getProprietyGetter', () => {
                const resource = createExpandedResource({
                    exports: {
                        connectionString: { name: 'getConnectionString', args: { format: 'full' } },
                        endpoint: { name: 'getEndpoint', args: {} }
                    }
                });
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('"connectionString": {');
                expect(result.content).toContain('getter: getProprietyGetter("getConnectionString")');
                expect(result.content).toContain('"endpoint": {');
                expect(result.content).toContain('getter: getProprietyGetter("getEndpoint")');
            });

            test('should serialize config as JSON', () => {
                const resource = createExpandedResource({
                    config: {
                        tier: 'premium',
                        replicas: 3,
                        enabled: true
                    }
                });
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('"tier": "premium"');
                expect(result.content).toContain('"replicas": 3');
                expect(result.content).toContain('"enabled": true');
            });

            test('should handle nested config objects', () => {
                const resource = createExpandedResource({
                    config: {
                        database: {
                            host: 'localhost',
                            port: 5432,
                            credentials: {
                                user: 'admin',
                                passwordRef: 'secret'
                            }
                        }
                    }
                });
                const result = generate('/test/source.yml', [resource]);

                expect(result.content).toContain('"database"');
                expect(result.content).toContain('"host": "localhost"');
                expect(result.content).toContain('"port": 5432');
                expect(result.content).toContain('"credentials"');
            });
        });

        describe('Multiple Resources', () => {
            test('should generate multiple resources from expansion', () => {
                const resources = [
                    createExpandedResource({ name: 'res1', ring: 'test' }),
                    createExpandedResource({ name: 'res1', ring: 'staging' }),
                    createExpandedResource({ name: 'res1', ring: 'production' })
                ];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('TestType_res1_test');
                expect(result.content).toContain('TestType_res1_staging');
                expect(result.content).toContain('TestType_res1_production');
                expect(result.resources).toHaveLength(3);
            });

            test('should register all resources', () => {
                const resources = [
                    createExpandedResource({ name: 'res', ring: 'test', region: 'eastus' }),
                    createExpandedResource({ name: 'res', ring: 'test', region: 'westus' })
                ];
                const result = generate('/test/source.yml', resources);

                expect(result.content).toContain('registerResource(TestType_res_test_eastus)');
                expect(result.content).toContain('registerResource(TestType_res_test_westus)');
            });
        });
    });

    describe('generateIndex', () => {
        test('should generate barrel export', () => {
            const files = [
                { fileName: 'resource1.ts', content: '', resources: [] },
                { fileName: 'resource2.ts', content: '', resources: [] }
            ];

            const result = generateIndex(files);

            expect(result.fileName).toBe('index.ts');
            expect(result.content).toContain('export * from');
        });

        test('should export all generated files', () => {
            const files = [
                { fileName: 'resource1.ts', content: '', resources: [] },
                { fileName: 'resource2.ts', content: '', resources: [] },
                { fileName: 'resource3.ts', content: '', resources: [] }
            ];

            const result = generateIndex(files);

            expect(result.content).toContain("export * from './resource1.js'");
            expect(result.content).toContain("export * from './resource2.js'");
            expect(result.content).toContain("export * from './resource3.js'");
        });

        test('should add warning comment', () => {
            const files = [
                { fileName: 'resource1.ts', content: '', resources: [] }
            ];

            const result = generateIndex(files);

            expect(result.content).toContain('DO NOT EDIT');
        });

        test('should use .js extensions for imports', () => {
            const files = [
                { fileName: 'resource1.ts', content: '', resources: [] },
                { fileName: 'resource2.ts', content: '', resources: [] }
            ];

            const result = generateIndex(files);

            expect(result.content).toContain('.js');
            expect(result.content).not.toContain('.ts');
        });

        test('should handle empty file list', () => {
            const files: any[] = [];

            const result = generateIndex(files);

            expect(result.fileName).toBe('index.ts');
            expect(result.content).toContain('DO NOT EDIT');
            expect(result.resources).toHaveLength(0);
        });
    });

    describe('formatJSON', () => {
        test('should format simple objects', () => {
            const resource = createExpandedResource({
                config: { a: 1, b: 2 }
            });
            const result = generate('/test/source.yml', [resource]);

            expect(result.content).toContain('"a": 1');
            expect(result.content).toContain('"b": 2');
        });

        test('should format nested objects with indentation', () => {
            const resource = createExpandedResource({
                config: {
                    outer: {
                        inner: {
                            value: 'test'
                        }
                    }
                }
            });
            const result = generate('/test/source.yml', [resource]);

            const normalized = normalizeGeneratedCode(result.content);
            expect(normalized).toContain('"outer"');
            expect(normalized).toContain('"inner"');
            expect(normalized).toContain('"value": "test"');
        });

        test('should handle arrays', () => {
            const resource = createExpandedResource({
                config: {
                    items: ['a', 'b', 'c']
                }
            });
            const result = generate('/test/source.yml', [resource]);

            expect(result.content).toContain('"items"');
            expect(result.content).toContain('"a"');
            expect(result.content).toContain('"b"');
            expect(result.content).toContain('"c"');
        });

        test('should handle null values', () => {
            const resource = createExpandedResource({
                config: {
                    value: null
                }
            });
            const result = generate('/test/source.yml', [resource]);

            expect(result.content).toContain('"value": null');
        });
    });
});
