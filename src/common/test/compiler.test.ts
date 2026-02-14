/**
 * Compiler orchestrator tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Compiler } from '../compiler.js';
import { createTempDir, cleanupTempDir, writeToTemp, loadFixture } from '../../test-utils/helpers.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';

describe('Compiler', () => {
    let tempDir: string;
    let outputDir: string;

    beforeEach(async () => {
        tempDir = await createTempDir();
        outputDir = await createTempDir();
    });

    afterEach(async () => {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(outputDir);
    });

    describe('compile', () => {
        describe('File Discovery', () => {
            test('should discover single YAML file when given file path', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThan(0);
            });

            test('should discover YAML files in directory', async () => {
                const compiler = new Compiler();
                const content1 = await loadFixture('valid', 'simple.yml');
                const content2 = await loadFixture('valid', 'multi-ring.yml');

                await writeToTemp(tempDir, 'resource1.yml', content1);
                await writeToTemp(tempDir, 'resource2.yml', content2);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThanOrEqual(3); // 2 resources + index
            });

            test('should discover YAML files recursively', async () => {
                const compiler = new Compiler();
                const subDir = join(tempDir, 'sub');
                await mkdir(subDir);

                const content = await loadFixture('valid', 'simple.yml');
                await writeToTemp(tempDir, 'resource1.yml', content);
                await writeToTemp(subDir, 'resource2.yml', content);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThanOrEqual(3);
            });

            test('should exclude node_modules', async () => {
                const compiler = new Compiler();
                const nodeModules = join(tempDir, 'node_modules');
                await mkdir(nodeModules);

                const content = await loadFixture('valid', 'simple.yml');
                await writeToTemp(tempDir, 'resource.yml', content);
                await writeToTemp(nodeModules, 'ignored.yml', content);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                // Should only generate files for resource.yml, not ignored.yml
                expect(result.generatedFiles.length).toBe(2); // 1 resource + index
            });

            test('should exclude hidden directories', async () => {
                const compiler = new Compiler();
                const hiddenDir = join(tempDir, '.hidden');
                await mkdir(hiddenDir);

                const content = await loadFixture('valid', 'simple.yml');
                await writeToTemp(tempDir, 'resource.yml', content);
                await writeToTemp(hiddenDir, 'ignored.yml', content);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBe(2); // 1 resource + index
            });

            test('should handle empty directory', async () => {
                const compiler = new Compiler();

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors[0].message).toContain('No YAML files found');
            });

            test('should accept both .yml and .yaml extensions', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');

                await writeToTemp(tempDir, 'resource1.yml', content);
                await writeToTemp(tempDir, 'resource2.yaml', content);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBe(3); // 2 resources + index
            });
        });

        describe('Full Pipeline Success', () => {
            test('should compile valid single file', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.errors).toHaveLength(0);

                // Check that at least one file matching resource.ts was generated
                const hasResourceFile = result.generatedFiles.some(f => f.endsWith('resource.ts'));
                expect(hasResourceFile).toBe(true);

                const hasIndexFile = result.generatedFiles.some(f => f.endsWith('index.ts'));
                expect(hasIndexFile).toBe(true);
            });

            test('should compile multiple files', async () => {
                const compiler = new Compiler();
                const content1 = await loadFixture('valid', 'simple.yml');
                const content2 = await loadFixture('valid', 'multi-ring.yml');

                await writeToTemp(tempDir, 'resource1.yml', content1);
                await writeToTemp(tempDir, 'resource2.yml', content2);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBe(3); // 2 resources + index
            });

            test('should write output files', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThan(0);

                // Files should actually exist
                const { access } = await import('fs/promises');
                for (const file of result.generatedFiles) {
                    await expect(access(file)).resolves.toBeUndefined();
                }
            });

            test('should generate index.ts', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.some(f => f.endsWith('index.ts'))).toBe(true);
            });

            test('should return success result', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result).toHaveProperty('success');
                expect(result).toHaveProperty('errors');
                expect(result).toHaveProperty('warnings');
                expect(result).toHaveProperty('generatedFiles');
                expect(result.success).toBe(true);
            });
        });

        describe('Error Handling', () => {
            test('should collect parse errors', async () => {
                const compiler = new Compiler();
                const invalidContent = await loadFixture('invalid', 'syntax-error.yml');
                const inputFile = await writeToTemp(tempDir, 'invalid.yml', invalidContent);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
            });

            test('should collect validation errors', async () => {
                const compiler = new Compiler();
                const invalidContent = await loadFixture('invalid', 'missing-required.yml');
                const inputFile = await writeToTemp(tempDir, 'invalid.yml', invalidContent);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
            });

            test('should stop on validation errors', async () => {
                const compiler = new Compiler();
                const invalidContent = await loadFixture('invalid', 'invalid-ring.yml');
                const inputFile = await writeToTemp(tempDir, 'invalid.yml', invalidContent);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(false);
                expect(result.generatedFiles).toHaveLength(0);
            });

            test('should continue parsing other files after one fails', async () => {
                const compiler = new Compiler();
                const validContent = await loadFixture('valid', 'simple.yml');
                const invalidContent = await loadFixture('invalid', 'syntax-error.yml');

                await writeToTemp(tempDir, 'valid.yml', validContent);
                await writeToTemp(tempDir, 'invalid.yml', invalidContent);

                const result = await compiler.compile({
                    inputPath: tempDir,
                    outputPath: outputDir
                });

                expect(result.success).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                // Should have parsed the valid file even though invalid failed
            });
        });

        describe('Validation-Only Mode', () => {
            test('should validate without generating code', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir,
                    validate: true
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles).toHaveLength(0);
            });

            test('should return errors without writing files', async () => {
                const compiler = new Compiler();
                const invalidContent = await loadFixture('invalid', 'invalid-ring.yml');
                const inputFile = await writeToTemp(tempDir, 'invalid.yml', invalidContent);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir,
                    validate: true
                });

                expect(result.success).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.generatedFiles).toHaveLength(0);
            });
        });

        describe('Output Management', () => {
            test('should create output directory', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);
                const newOutputDir = join(tempDir, 'new-output');

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: newOutputDir
                });

                expect(result.success).toBe(true);

                const { access } = await import('fs/promises');
                await expect(access(newOutputDir)).resolves.toBeUndefined();

                await cleanupTempDir(newOutputDir);
            });

            test('should write all generated files', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'multi-region.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThan(0);

                // Verify all files exist
                const { access } = await import('fs/promises');
                for (const file of result.generatedFiles) {
                    await expect(access(file)).resolves.toBeUndefined();
                }
            });

            test('should return list of generated files', async () => {
                const compiler = new Compiler();
                const content = await loadFixture('valid', 'simple.yml');
                const inputFile = await writeToTemp(tempDir, 'resource.yml', content);

                const result = await compiler.compile({
                    inputPath: inputFile,
                    outputPath: outputDir
                });

                expect(result.success).toBe(true);
                expect(Array.isArray(result.generatedFiles)).toBe(true);
                expect(result.generatedFiles.length).toBeGreaterThan(0);
                result.generatedFiles.forEach(file => {
                    expect(typeof file).toBe('string');
                    expect(file).toContain(outputDir);
                });
            });
        });
    });
});
