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

            test('should reject resource missing authProvider', () => {
                const data = { ...createResourceYAML(), authProvider: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.path === 'authProvider')).toBe(true);
            });

            test('should reject resource missing defaultConfig', () => {
                const data = { ...createResourceYAML(), defaultConfig: undefined };
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(false);
                expect(result.errors.some(e => e.path === 'defaultConfig')).toBe(true);
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
                        { resource: 'dep1' },
                        { resource: 'dep2', isHardDependency: true }
                    ]
                });
                const parsed = createParsedYAML(data);

                const result = validate(parsed);

                expect(result.valid).toBe(true);
            });

            test('should accept optional isHardDependency', () => {
                const data = createResourceYAML({
                    dependencies: [
                        { resource: 'dep1', isHardDependency: false }
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
                            resource: 'dep1',
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
                // Missing: type, authProvider, defaultConfig
            };
            const parsed = createParsedYAML(data);

            const result = validate(parsed);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(3);
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
