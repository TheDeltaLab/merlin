/**
 * Parser unit tests
 */

import { describe, test, expect } from 'vitest';
import { parseFile } from '../parser.js';
import { ErrorSeverity } from '../types.js';
import { loadFixture, createTempDir, cleanupTempDir, writeToTemp, assertErrorStructure } from '../../test-utils/helpers.js';

describe('Parser', () => {
    describe('parseFile', () => {
        describe('Success Cases', () => {
            test('should parse valid YAML file', async () => {
                const content = await loadFixture('valid', 'simple.yml');
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'simple.yml', content);

                const result = await parseFile(tempFile);

                expect(result.source).toBe(tempFile);
                expect(result.data).toBeDefined();
                expect(result.data.name).toBe('simple-resource');
                expect(result.data.type).toBe('SimpleType');
                expect(result.data.ring).toBe('test');

                await cleanupTempDir(tempDir);
            });

            test('should handle UTF-8 content', async () => {
                const content = 'name: 测试资源\ntype: TestType\nring: test\nauthProvider: test\ndefaultConfig: {}';
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'utf8.yml', content);

                const result = await parseFile(tempFile);

                expect(result.data.name).toBe('测试资源');

                await cleanupTempDir(tempDir);
            });

            test('should handle files with comments', async () => {
                const content = `# This is a comment
name: test-resource
type: TestType  # inline comment
ring: test
authProvider: testAuth
defaultConfig:
  # nested comment
  value: basic`;
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'comments.yml', content);

                const result = await parseFile(tempFile);

                expect(result.data.name).toBe('test-resource');
                expect(result.data.defaultConfig.value).toBe('basic');

                await cleanupTempDir(tempDir);
            });

            test('should preserve YAML structure', async () => {
                const content = await loadFixture('valid', 'complex.yml');
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'complex.yml', content);

                const result = await parseFile(tempFile);

                expect(result.data).toHaveProperty('name');
                expect(result.data).toHaveProperty('type');
                expect(result.data).toHaveProperty('ring');
                expect(result.data).toHaveProperty('authProvider');
                expect(result.data).toHaveProperty('defaultConfig');
                expect(result.data).toHaveProperty('dependencies');
                expect(result.data).toHaveProperty('exports');

                await cleanupTempDir(tempDir);
            });

            test('should handle empty defaultConfig', async () => {
                const content = 'name: test\ntype: TestType\nring: test\nauthProvider: test\ndefaultConfig: {}';
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'empty-config.yml', content);

                const result = await parseFile(tempFile);

                expect(result.data.defaultConfig).toEqual({});

                await cleanupTempDir(tempDir);
            });
        });

        describe('Error Cases', () => {
            test('should throw on missing file', async () => {
                await expect(parseFile('/nonexistent/file.yml')).rejects.toMatchObject({
                    severity: ErrorSeverity.ERROR,
                    message: expect.stringContaining('Failed to read file'),
                    hint: expect.stringContaining('file exists')
                });
            });

            test('should throw on YAML syntax errors', async () => {
                const content = await loadFixture('invalid', 'syntax-error.yml');
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'syntax-error.yml', content);

                await expect(parseFile(tempFile)).rejects.toMatchObject({
                    severity: ErrorSeverity.ERROR,
                    message: expect.stringContaining('YAML syntax error')
                });

                await cleanupTempDir(tempDir);
            });

            test('should provide line/column info for syntax errors', async () => {
                const invalidYAML = 'name: test\n  invalid: : syntax';
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'invalid.yml', invalidYAML);

                try {
                    await parseFile(tempFile);
                    expect.fail('Should have thrown an error');
                } catch (error: any) {
                    expect(error.severity).toBe(ErrorSeverity.ERROR);
                    expect(error.message).toContain('YAML syntax error');
                    expect(error).toHaveProperty('line');
                    expect(error).toHaveProperty('column');
                    expect(error.hint).toBeDefined();
                }

                await cleanupTempDir(tempDir);
            });

            test('should handle malformed YAML gracefully', async () => {
                const content = 'name: test\ntype: [unclosed array';
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'malformed.yml', content);

                await expect(parseFile(tempFile)).rejects.toMatchObject({
                    severity: ErrorSeverity.ERROR,
                    message: expect.stringContaining('YAML syntax error')
                });

                await cleanupTempDir(tempDir);
            });
        });

        describe('Error Formatting', () => {
            test('should create proper CompilationError for YAML errors', async () => {
                const content = await loadFixture('invalid', 'syntax-error.yml');
                const tempDir = await createTempDir();
                const tempFile = await writeToTemp(tempDir, 'error.yml', content);

                await expect(parseFile(tempFile)).rejects.toMatchObject({
                    severity: ErrorSeverity.ERROR,
                    source: tempFile,
                    hint: expect.stringContaining('YAML syntax')
                });

                await cleanupTempDir(tempDir);
            });

            test('should create proper CompilationError for file read errors', async () => {
                try {
                    await parseFile('/nonexistent/path/file.yml');
                    expect.fail('Should have thrown an error');
                } catch (error: any) {
                    assertErrorStructure(error);
                    expect(error.hint).toContain('file exists');
                }
            });

            test('should include helpful hints in errors', async () => {
                try {
                    await parseFile('/this/path/does/not/exist.yml');
                    expect.fail('Should have thrown an error');
                } catch (error: any) {
                    expect(error.hint).toBeDefined();
                    expect(typeof error.hint).toBe('string');
                    expect(error.hint.length).toBeGreaterThan(0);
                }
            });
        });
    });
});
