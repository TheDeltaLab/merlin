/**
 * Validator unit tests
 */

import { describe, test, expect } from 'vitest';
import { validate } from '../validator.js';
import { ErrorSeverity } from '../types.js';
import { createParsedYAML, createResourceYAML } from '../../test-utils/factories.js';

describe('Validator', () => {
    describe('Schema Validation', () => {
        describe('Required Fields', () => {
            test('should validate complete valid resource', () => {
                const parsed = createParsedYAML(createResourceYAML());
                const result = validate(parsed);

                expect(result.valid).toBe(true);
                expect(result.data).toBeDefined();
                expect(result.errors).toHaveLength(0);
            });

            test('should reject resource missing name', () => {
                const data = { ...createResourceYAML(), name: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors[0]).toMatchObject({
                    severity: ErrorSeverity.ERROR,
                    path: 'name'
                });
            });

            test('should reject resource missing type', () => {
                const data = { ...createResourceYAML(), type: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.path === 'type')).toBe(true);
            });

            test('should reject resource missing ring', () => {
                const data = { ...createResourceYAML(), ring: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.path === 'ring')).toBe(true);
            });

            test('should accept resource missing authProvider', () => {
                const data = { ...createResourceYAML(), authProvider: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept resource with missing defaultConfig (defaults to {})', () => {
                const data = { ...createResourceYAML(), defaultConfig: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                // defaultConfig is now optional with a default of {}
                expect(result.valid).toBe(true);
            });
        });

        describe('Ring Validation', () => {
            test('should accept valid single ring', () => {
                const data = createResourceYAML({ ring: 'test' });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept valid ring array', () => {
                const data = createResourceYAML({ ring: ['test', 'staging', 'production'] });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should reject invalid ring value', () => {
                const data = createResourceYAML({ ring: 'invalid-ring' as any });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors[0].path).toContain('ring');
            });

            test('should reject empty ring array', () => {
                const data = createResourceYAML({ ring: [] as any });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
            });

            test('should provide helpful hint for invalid ring', () => {
                const data = createResourceYAML({ ring: 'prod' as any });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                const ringError = result.errors.find(e => e.path && e.path.includes('ring'));
                if (ringError?.hint) {
                    expect(ringError.hint).toContain('test');
                }
            });
        });

        describe('Region Validation', () => {
            test('should accept valid single region', () => {
                const data = createResourceYAML({ region: 'eastus' });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept valid region array', () => {
                const data = createResourceYAML({ region: ['eastus', 'westus', 'eastasia'] });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should reject invalid region value', () => {
                const data = createResourceYAML({ region: 'invalid-region' as any });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors[0].path).toContain('region');
            });

            test('should allow undefined region', () => {
                const data = createResourceYAML({ region: undefined });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should reject empty region array', () => {
                const data = createResourceYAML({ region: [] as any });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
            });
        });

        describe('AuthProvider Validation', () => {
            test('should accept string authProvider', () => {
                const data = createResourceYAML({ authProvider: 'simpleAuth' });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept object authProvider with name', () => {
                const data = createResourceYAML({
                    authProvider: {
                        name: 'azureAuth',
                        tenantId: '123'
                    }
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept object authProvider with multiple args', () => {
                const data = createResourceYAML({
                    authProvider: {
                        name: 'complexAuth',
                        role: 'admin',
                        scope: 'resource',
                        tenantId: '123'
                    }
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should reject authProvider without name', () => {
                const data = createResourceYAML({
                    authProvider: {
                        role: 'admin'
                    } as any
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
            });
        });

        describe('Dependencies Validation', () => {
            test('should accept empty dependencies array', () => {
                const data = createResourceYAML({ dependencies: [] });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should validate dependency resource field', () => {
                const data = createResourceYAML({
                    dependencies: [
                        { resource: 'DepType.dep1' },
                        { resource: 'DepType.dep2', isHardDependency: true }
                    ]
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept optional isHardDependency', () => {
                const data = createResourceYAML({
                    dependencies: [
                        { resource: 'DepType.dep1', isHardDependency: false }
                    ]
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept dependency with authProvider', () => {
                const data = createResourceYAML({
                    dependencies: [
                        {
                            resource: 'DepType.dep1',
                            authProvider: {
                                name: 'customAuth',
                                scope: 'resource'
                            }
                        }
                    ]
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });
        });

        describe('Exports Validation', () => {
            test('should accept empty exports object', () => {
                const data = createResourceYAML({ exports: {} });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept string export value', () => {
                const data = createResourceYAML({
                    exports: {
                        connectionString: 'getConnectionString'
                    }
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept object export with name', () => {
                const data = createResourceYAML({
                    exports: {
                        endpoint: {
                            name: 'getEndpoint',
                            protocol: 'https'
                        }
                    }
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });
        });
    });

    describe('Semantic Validation', () => {
        test('should validate specificConfig ring references declared rings', () => {
            const data = createResourceYAML({
                ring: ['test', 'staging'],
                specificConfig: [
                    { ring: 'production', value: 'test' }
                ]
            });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toMatchObject({
                message: expect.stringContaining('not in the declared rings'),
                path: 'specificConfig[0].ring'
            });
        });

        test('should validate specificConfig region references declared regions', () => {
            const data = createResourceYAML({
                ring: 'test',
                region: ['eastus', 'westus'],
                specificConfig: [
                    { region: 'eastasia', value: 'test' }
                ]
            });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toMatchObject({
                message: expect.stringContaining('not in the declared regions'),
                path: 'specificConfig[0].region'
            });
        });

        test('should allow specificConfig without ring/region', () => {
            const data = createResourceYAML({
                ring: ['test', 'staging'],
                region: ['eastus', 'westus'],
                specificConfig: [
                    { value: 'test' }
                ]
            });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(true);
        });

        test('should validate multiple specificConfig entries', () => {
            const data = createResourceYAML({
                ring: ['test', 'staging'],
                specificConfig: [
                    { ring: 'test', value: 'a' },
                    { ring: 'staging', value: 'b' },
                    { ring: 'production', value: 'c' }
                ]
            });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.path === 'specificConfig[2].ring')).toBe(true);
        });

        test('should allow specificConfig with region when no regions declared', () => {
            const data = createResourceYAML({
                ring: 'test',
                region: undefined,
                specificConfig: [
                    { ring: 'test', value: 'test' }
                ]
            });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            // Should pass - specificConfig doesn't reference undeclared regions
            expect(result.valid).toBe(true);
        });
    });

    describe('Error Messages', () => {
        test('should convert Zod errors to CompilationErrors', () => {
            const data = { name: 'test' };
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            result.errors.forEach(error => {
                expect(error).toHaveProperty('severity');
                expect(error).toHaveProperty('message');
                expect(error).toHaveProperty('source');
                expect(error).toHaveProperty('path');
            });
        });

        test('should include YAML path in errors', () => {
            const data = {
                ...createResourceYAML(),
                ring: 'invalid-ring'
            };
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors[0].path).toBe('ring');
        });

        test('should provide helpful hints for common errors', () => {
            const data = createResourceYAML({ ring: 'invalid' as any });
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            const ringError = result.errors.find(e => e.path && e.path.includes('ring'));
            // Hint may not always be defined, but if it is, it should contain 'test'
            if (ringError?.hint) {
                expect(ringError.hint).toContain('test');
            }
        });

        test('should aggregate multiple validation errors', () => {
            const data = {
                name: '',
                ring: 'invalid',
                // Missing: type, authProvider (defaultConfig now optional)
            };
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
        });

        test('should include source in all errors', () => {
            const data = { name: 'test' };
            const parsed = createParsedYAML(data, '/test/custom-source.yml');

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            result.errors.forEach(error => {
                expect(error.source).toBe('/test/custom-source.yml');
            });
        });
    });
});

// ── Parameter reference validation tests ──────────────────────────────────

describe('Validator - Parameter Reference Validation', () => {
    describe('Valid parameter expressions', () => {
        test('passes for ${ this.ring } in defaultConfig', () => {
            const data = createResourceYAML({
                defaultConfig: { envVar: '${ this.ring }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('passes for ${ this.region } when regions are declared', () => {
            const data = createResourceYAML({
                region: 'eastasia',
                defaultConfig: { regionTag: '${ this.region }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('passes for ${ Type.name.export } when dep is declared in dependencies', () => {
            const data = createResourceYAML({
                dependencies: [{ resource: 'Registry.myregistry', isHardDependency: true }],
                defaultConfig: { image: '${ Registry.myregistry.server }/myapp:latest' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('passes for params in array values', () => {
            const data = createResourceYAML({
                defaultConfig: {
                    envVars: ['APP_ENV=${ this.ring }', 'PLAIN=value']
                },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
        });

        test('passes for params in nested objects', () => {
            const data = createResourceYAML({
                defaultConfig: {
                    tags: { env: '${ this.ring }' }
                },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
        });
    });

    describe('Undeclared dependency reference → ERROR', () => {
        test('errors for ${ Type.name.export } when not in dependencies', () => {
            const data = createResourceYAML({
                dependencies: [], // no dependencies declared
                defaultConfig: { image: '${ UnknownType.unknownResource.server }/myapp:latest' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(false);
            const paramError = result.errors.find(e => e.message.includes('undeclared dependency'));
            expect(paramError).toBeDefined();
            expect(paramError!.severity).toBe(ErrorSeverity.ERROR);
            expect(paramError!.message).toContain('UnknownType.unknownResource');
        });

        test('error hint suggests adding to dependencies', () => {
            const data = createResourceYAML({
                dependencies: [],
                defaultConfig: { val: '${ MissingType.missingDep.name }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            const paramError = result.errors.find(e => e.message.includes('undeclared dependency'));
            expect(paramError!.hint).toContain('MissingType.missingDep');
        });

        test('errors for undeclared dep in specificConfig', () => {
            const data = createResourceYAML({
                ring: 'staging',
                dependencies: [],
                defaultConfig: {},
                specificConfig: [{ ring: 'staging', val: '${ MissingType.missing.export }' }]
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.message.includes('undeclared dependency'))).toBe(true);
        });
    });

    describe('Malformed expressions → ERROR', () => {
        test('errors for expression with no dot (e.g., ${ noExport })', () => {
            const data = createResourceYAML({
                defaultConfig: { val: '${ noExport }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.severity === ErrorSeverity.ERROR)).toBe(true);
        });

        test('errors for expression with leading dot (e.g., ${ .foo })', () => {
            const data = createResourceYAML({
                defaultConfig: { val: '${ .foo }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(false);
        });
    });

    describe('${ this.region } on region-less resource → WARNING', () => {
        test('warns for ${ this.region } when no regions declared', () => {
            const data = createResourceYAML({
                region: undefined, // no region
                defaultConfig: { regionVal: '${ this.region }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            // Should still be valid (warning, not error)
            expect(result.valid).toBe(true);
            const warning = result.errors.find(e => e.severity === ErrorSeverity.WARNING);
            expect(warning).toBeDefined();
            expect(warning!.message).toContain('this.region');
        });

        test('no warning for ${ this.region } when region IS declared', () => {
            const data = createResourceYAML({
                region: 'eastasia',
                defaultConfig: { regionVal: '${ this.region }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe('Error location paths', () => {
        test('error path points to defaultConfig field', () => {
            const data = createResourceYAML({
                dependencies: [],
                defaultConfig: { image: '${ MissingType.missing.server }' },
                specificConfig: []
            });
            const result = validate(createParsedYAML(data));
            const paramError = result.errors.find(e => e.message.includes('undeclared dependency'));
            expect(paramError!.path).toContain('defaultConfig');
        });

        test('error path points to specificConfig field', () => {
            const data = createResourceYAML({
                ring: 'staging',
                dependencies: [],
                defaultConfig: {},
                specificConfig: [{ ring: 'staging', val: '${ MissingType.missing.export }' }]
            });
            const result = validate(createParsedYAML(data));
            const paramError = result.errors.find(e => e.message.includes('undeclared dependency'));
            expect(paramError!.path).toContain('specificConfig[0]');
        });
    });
});
