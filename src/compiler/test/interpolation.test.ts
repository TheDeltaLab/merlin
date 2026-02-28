/**
 * Unit tests for compile-time parameter interpolation parser
 */

import { describe, test, expect } from 'vitest';
import { parseParamString, parseConfigParams } from '../interpolation.js';
import { isParamValue } from '../types.js';

describe('parseParamString', () => {
    describe('Plain strings (no parameters)', () => {
        test('returns null for plain string', () => {
            expect(parseParamString('hello world')).toBeNull();
        });

        test('returns null for empty string', () => {
            expect(parseParamString('')).toBeNull();
        });

        test('returns null for string with no ${ }', () => {
            expect(parseParamString('myapp:latest')).toBeNull();
        });

        test('returns null for string with $ but no braces', () => {
            expect(parseParamString('$100')).toBeNull();
        });
    });

    describe('${ this.ring } expressions', () => {
        test('parses ${ this.ring } as self.ring segment', () => {
            const result = parseParamString('${ this.ring }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(1);
            expect(result!.segments[0]).toEqual({ type: 'self', field: 'ring' });
        });

        test('parses ${this.ring} without spaces', () => {
            const result = parseParamString('${this.ring}');
            expect(result).not.toBeNull();
            expect(result!.segments[0]).toEqual({ type: 'self', field: 'ring' });
        });

        test('parses ${ this.ring } embedded in string', () => {
            const result = parseParamString('env=${ this.ring }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(2);
            expect(result!.segments[0]).toEqual({ type: 'literal', value: 'env=' });
            expect(result!.segments[1]).toEqual({ type: 'self', field: 'ring' });
        });
    });

    describe('${ this.region } expressions', () => {
        test('parses ${ this.region } as self.region segment', () => {
            const result = parseParamString('${ this.region }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(1);
            expect(result!.segments[0]).toEqual({ type: 'self', field: 'region' });
        });

        test('parses ${ this.region } embedded in string', () => {
            const result = parseParamString('REGION=${ this.region }');
            expect(result).not.toBeNull();
            expect(result!.segments[0]).toEqual({ type: 'literal', value: 'REGION=' });
            expect(result!.segments[1]).toEqual({ type: 'self', field: 'region' });
        });
    });

    describe('${ Type.resourceName.exportKey } expressions', () => {
        test('parses ${ AzureContainerRegistry.chuangacr.server } as dep segment', () => {
            const result = parseParamString('${ AzureContainerRegistry.chuangacr.server }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(1);
            expect(result!.segments[0]).toEqual({ type: 'dep', resourceType: 'AzureContainerRegistry', resource: 'chuangacr', export: 'server' });
        });

        test('parses dep expression with suffix', () => {
            const result = parseParamString('${ AzureContainerRegistry.chuangacr.server }/myapp:latest');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(2);
            expect(result!.segments[0]).toEqual({ type: 'dep', resourceType: 'AzureContainerRegistry', resource: 'chuangacr', export: 'server' });
            expect(result!.segments[1]).toEqual({ type: 'literal', value: '/myapp:latest' });
        });

        test('parses dep expression with prefix and suffix', () => {
            const result = parseParamString('prefix/${ Storage.myresource.name }/suffix');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(3);
            expect(result!.segments[0]).toEqual({ type: 'literal', value: 'prefix/' });
            expect(result!.segments[1]).toEqual({ type: 'dep', resourceType: 'Storage', resource: 'myresource', export: 'name' });
            expect(result!.segments[2]).toEqual({ type: 'literal', value: '/suffix' });
        });
    });

    describe('Multiple expressions', () => {
        test('parses two dep expressions', () => {
            const result = parseParamString('${ TypeA.a.x }/${ TypeB.b.y }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(3);
            expect(result!.segments[0]).toEqual({ type: 'dep', resourceType: 'TypeA', resource: 'a', export: 'x' });
            expect(result!.segments[1]).toEqual({ type: 'literal', value: '/' });
            expect(result!.segments[2]).toEqual({ type: 'dep', resourceType: 'TypeB', resource: 'b', export: 'y' });
        });

        test('parses mixed self and dep expressions', () => {
            const result = parseParamString('APP_ENV=${ this.ring }-${ Registry.myres.name }');
            expect(result).not.toBeNull();
            expect(result!.segments).toHaveLength(4);
            expect(result!.segments[0]).toEqual({ type: 'literal', value: 'APP_ENV=' });
            expect(result!.segments[1]).toEqual({ type: 'self', field: 'ring' });
            expect(result!.segments[2]).toEqual({ type: 'literal', value: '-' });
            expect(result!.segments[3]).toEqual({ type: 'dep', resourceType: 'Registry', resource: 'myres', export: 'name' });
        });
    });

    describe('ParamValue brand sentinel', () => {
        test('returned ParamValue has __merlin_param__ = true', () => {
            const result = parseParamString('${ this.ring }');
            expect(result).not.toBeNull();
            expect(result!.__merlin_param__).toBe(true);
        });

        test('isParamValue identifies returned value', () => {
            const result = parseParamString('${ this.ring }');
            expect(isParamValue(result)).toBe(true);
        });

        test('isParamValue returns false for plain objects', () => {
            expect(isParamValue({ type: 'literal', value: 'test' })).toBe(false);
            expect(isParamValue('string')).toBe(false);
            expect(isParamValue(null)).toBe(false);
        });
    });

    describe('Error cases', () => {
        test('throws for expression with no dot (e.g., ${ noExport })', () => {
            expect(() => parseParamString('${ noExport }')).toThrow(
                'Invalid parameter expression'
            );
        });

        test('throws for expression with leading dot (e.g., ${ .foo })', () => {
            expect(() => parseParamString('${ .foo }')).toThrow(
                'Invalid parameter expression'
            );
        });

        test('throws for expression with trailing dot (e.g., ${ resource. })', () => {
            expect(() => parseParamString('${ resource. }')).toThrow(
                'Invalid parameter expression'
            );
        });

        test('throws for old format with single dot (e.g., ${ name.export })', () => {
            // Old format ${ name.export } only has one dot, which is no longer valid.
            // The new format requires two dots: ${ Type.name.export }
            expect(() => parseParamString('${ chuangacr.server }')).toThrow(
                'Invalid parameter expression'
            );
        });

        test('throws for old format with single dot embedded in string', () => {
            expect(() => parseParamString('prefix/${ myresource.name }/suffix')).toThrow(
                'Invalid parameter expression'
            );
        });

        test('error message suggests new Type.name.exportKey format', () => {
            expect(() => parseParamString('${ chuangacr.server }')).toThrow(
                '<Type>.<name>.<exportKey>'
            );
        });

        test('${ this.name } with single dot is not a valid dep or self reference', () => {
            // "this.name" has only one dot and is neither "this.ring" nor "this.region",
            // so it is treated as an invalid single-dot expression.
            expect(() => parseParamString('${ this.name }')).toThrow(
                'Invalid parameter expression'
            );
        });
    });
});

describe('parseConfigParams', () => {
    describe('String values', () => {
        test('wraps parameterized string in ParamValue', () => {
            const config = { image: '${ AzureContainerRegistry.acr.server }/myapp:latest' };
            const result = parseConfigParams(config);
            expect(isParamValue(result.image)).toBe(true);
        });

        test('leaves plain string unchanged', () => {
            const config = { name: 'myapp' };
            const result = parseConfigParams(config);
            expect(result.name).toBe('myapp');
        });

        test('leaves empty string unchanged', () => {
            const config = { value: '' };
            const result = parseConfigParams(config);
            expect(result.value).toBe('');
        });
    });

    describe('Non-string primitive values', () => {
        test('leaves number values unchanged', () => {
            const config = { cpu: 0.5, replicas: 3 };
            const result = parseConfigParams(config);
            expect(result.cpu).toBe(0.5);
            expect(result.replicas).toBe(3);
        });

        test('leaves boolean values unchanged', () => {
            const config = { httpsOnly: true, noWait: false };
            const result = parseConfigParams(config);
            expect(result.httpsOnly).toBe(true);
            expect(result.noWait).toBe(false);
        });

        test('leaves null values unchanged', () => {
            const config = { value: null };
            const result = parseConfigParams(config);
            expect(result.value).toBeNull();
        });
    });

    describe('Array values', () => {
        test('processes parameterized strings inside arrays', () => {
            const config = {
                envVars: [
                    'APP_ENV=${ this.ring }',
                    'STORAGE_ACCOUNT=${ AzureBlobStorage.myabs.name }'
                ]
            };
            const result = parseConfigParams(config);
            const envVars = result.envVars as unknown[];
            expect(isParamValue(envVars[0])).toBe(true);
            expect(isParamValue(envVars[1])).toBe(true);
        });

        test('leaves plain string array elements unchanged', () => {
            const config = { items: ['a', 'b', 'c'] };
            const result = parseConfigParams(config);
            expect(result.items).toEqual(['a', 'b', 'c']);
        });

        test('handles mixed arrays (plain + parameterized)', () => {
            const config = { envVars: ['PLAIN=value', 'ENV=${ this.ring }'] };
            const result = parseConfigParams(config);
            const envVars = result.envVars as unknown[];
            expect(envVars[0]).toBe('PLAIN=value');
            expect(isParamValue(envVars[1])).toBe(true);
        });
    });

    describe('Nested objects', () => {
        test('processes parameterized strings in nested objects', () => {
            const config = {
                database: {
                    host: '${ AzureDatabase.mydb.host }',
                    port: 5432
                }
            };
            const result = parseConfigParams(config);
            const db = result.database as Record<string, unknown>;
            expect(isParamValue(db.host)).toBe(true);
            expect(db.port).toBe(5432);
        });

        test('handles deeply nested config', () => {
            const config = {
                level1: {
                    level2: {
                        value: '${ Registry.dep.export }'
                    }
                }
            };
            const result = parseConfigParams(config);
            const l2 = (result.level1 as any).level2;
            expect(isParamValue(l2.value)).toBe(true);
        });
    });

    describe('Real-world YAML patterns', () => {
        test('processes chuangaca.yml-like config', () => {
            const config = {
                image: '${ AzureContainerRegistry.chuangacr.server }/myapp:latest',
                containerName: 'myapp',
                cpu: 0.5,
                memory: '1Gi',
                envVars: [
                    'APP_ENV=${ this.ring }',
                    'STORAGE_ACCOUNT=${ AzureBlobStorage.chuangabs.name }'
                ],
                tags: {
                    merlin: 'true',
                    env: '${ this.ring }'
                }
            };
            const result = parseConfigParams(config);

            expect(isParamValue(result.image)).toBe(true);
            expect(result.containerName).toBe('myapp');
            expect(result.cpu).toBe(0.5);
            expect(result.memory).toBe('1Gi');

            const envVars = result.envVars as unknown[];
            expect(isParamValue(envVars[0])).toBe(true);
            expect(isParamValue(envVars[1])).toBe(true);

            const tags = result.tags as Record<string, unknown>;
            expect(tags.merlin).toBe('true');
            expect(isParamValue(tags.env)).toBe(true);
        });
    });
});
