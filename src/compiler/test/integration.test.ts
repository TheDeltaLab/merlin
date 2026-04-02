/**
 * Integration tests for end-to-end compilation
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Compiler } from '../../common/compiler.js';
import { createTempDir, cleanupTempDir, writeToTemp, loadFixture } from '../../test-utils/helpers.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Mock pnpm availability to skip slow pnpm install/build during tests
vi.mock('../../compiler/initializer.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../compiler/initializer.js')>();
    return {
        ...original,
        checkPnpmAvailable: vi.fn().mockResolvedValue(false),
    };
});

describe('Integration Tests', () => {
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

    describe('End-to-End Compilation', () => {
        test('should compile simple resource', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'simple.yml');
            const inputFile = await writeToTemp(tempDir, 'simple.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('simple.ts'));
            expect(generatedFile).toBeDefined();

            const generatedCode = await readFile(generatedFile!, 'utf-8');
            expect(generatedCode).toContain('SimpleType_simple_resource_test');
            expect(generatedCode).toContain('name: "simple-resource"');
            expect(generatedCode).toContain('ring: "test"');
        });

        test('should compile multi-ring resource', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'multi-ring.yml');
            const inputFile = await writeToTemp(tempDir, 'multi-ring.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('multi-ring.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Should generate 3 resources (test, staging, production)
            expect(generatedCode).toContain('TestType_multi_ring_test');
            expect(generatedCode).toContain('TestType_multi_ring_staging');
            expect(generatedCode).toContain('TestType_multi_ring_production');
        });

        test('should compile multi-region resource', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'multi-region.yml');
            const inputFile = await writeToTemp(tempDir, 'multi-region.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('multi-region.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Should generate 4 resources (2 rings × 2 regions)
            expect(generatedCode).toContain('TestType_multi_region_staging_eastus');
            expect(generatedCode).toContain('TestType_multi_region_staging_westus');
            expect(generatedCode).toContain('TestType_multi_region_production_eastus');
            expect(generatedCode).toContain('TestType_multi_region_production_westus');
        });

        test('should compile complex resource with all features', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'complex.yml');
            const inputFile = await writeToTemp(tempDir, 'complex.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('complex.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Should have project and parent
            expect(generatedCode).toContain('project: "my-project"');
            expect(generatedCode).toContain('parent: "ParentType.parent-resource"');

            // Should have authProvider with args
            expect(generatedCode).toContain('getAuthProvider("azureAuth")');
            expect(generatedCode).toContain('tenantId');

            // Should have dependencies
            expect(generatedCode).toContain('dependencies:');
            expect(generatedCode).toContain('DepType1.dependency1');

            // Should have exports
            expect(generatedCode).toContain('getPropertyGetter("getConnectionString")');
            expect(generatedCode).toContain('getPropertyGetter("getEndpoint")');
        });

        test('should compile resource with dependencies', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'complex.yml');
            const inputFile = await writeToTemp(tempDir, 'complex.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('complex.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            expect(generatedCode).toContain('resource: "DepType1.dependency1"');
            expect(generatedCode).toContain('isHardDependency: true');
        });

        test('should compile resource with exports', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'complex.yml');
            const inputFile = await writeToTemp(tempDir, 'complex.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('complex.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            expect(generatedCode).toContain('exports: {');
            expect(generatedCode).toContain('"connectionString"');
            expect(generatedCode).toContain('"endpoint"');
        });
    });

    describe('Generated Code Validation', () => {
        test('generated code should be syntactically valid TypeScript', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'simple.yml');
            const inputFile = await writeToTemp(tempDir, 'simple.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('simple.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Basic syntax checks
            expect(generatedCode).toContain('import {');
            expect(generatedCode).toContain('export const');
            expect(generatedCode).not.toContain('undefined');
            expect(generatedCode).toMatch(/registerResource\([\w-]+\);/);
        });

        test('generated code should use correct variable names', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'multi-region.yml');
            const inputFile = await writeToTemp(tempDir, 'multi-region.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('multi-region.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Variable names should follow pattern: type_name_ring_region
            expect(generatedCode).toMatch(/export const \w+_multi_region_\w+_\w+: Resource/);
        });

        test('config merging should produce expected values', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'with-specific-config.yml');
            const inputFile = await writeToTemp(tempDir, 'with-specific-config.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('with-specific-config.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Staging resources should have premium tier
            const stagingResource = generatedCode.match(/TestType_with_specific_config_staging_eastus[\s\S]*?registerResource/);
            expect(stagingResource).toBeDefined();
            expect(stagingResource![0]).toContain('"tier": "premium"');
        });

        test('specificConfig overrides should apply correctly', async () => {
            const compiler = new Compiler();
            const content = await loadFixture('valid', 'multi-region.yml');
            const inputFile = await writeToTemp(tempDir, 'multi-region.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('multi-region.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Production + eastus should have premium tier
            const productionEastus = generatedCode.match(/TestType_multi_region_production_eastus[\s\S]*?registerResource/);
            expect(productionEastus).toBeDefined();
            expect(productionEastus![0]).toContain('"tier": "premium"');

            // Other resources should have basic tier
            const stagingWestus = generatedCode.match(/TestType_multi_region_staging_westus[\s\S]*?registerResource/);
            expect(stagingWestus).toBeDefined();
            expect(stagingWestus![0]).toContain('"tier": "basic"');
        });
    });

    describe('Real-World Scenarios', () => {
        test('should handle nested config merging', async () => {
            const compiler = new Compiler();
            const content = `name: database
type: Database
ring: test
authProvider: dbAuth
defaultConfig:
  connection:
    host: localhost
    port: 5432
    ssl: false
  poolSize: 10
specificConfig:
  - ring: test
    connection:
      ssl: true
      port: 3306
dependencies: []
exports: {}`;

            const inputFile = await writeToTemp(tempDir, 'database.yml', content);

            const result = await compiler.compile({
                inputPath: inputFile,
                outputPath: outputDir
            });

            expect(result.success).toBe(true);

            const generatedFile = result.generatedFiles.find(f => f.endsWith('database.ts'));
            const generatedCode = await readFile(generatedFile!, 'utf-8');

            // Should deep merge connection object
            expect(generatedCode).toContain('"host": "localhost"'); // Preserved
            expect(generatedCode).toContain('"ssl": true'); // Overridden
            expect(generatedCode).toContain('"port": 3306'); // Overridden
            expect(generatedCode).toContain('"poolSize": 10'); // Preserved
        });

        test('should generate index.ts with all exports', async () => {
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

            const indexFile = result.generatedFiles.find(f => f.endsWith('index.ts'));
            expect(indexFile).toBeDefined();

            const indexCode = await readFile(indexFile!, 'utf-8');
            expect(indexCode).toContain("export * from './resource1.js'");
            expect(indexCode).toContain("export * from './resource2.js'");
            expect(indexCode).toContain('DO NOT EDIT');
        });

        test('should handle multiple files with errors', async () => {
            const compiler = new Compiler();
            const validContent = await loadFixture('valid', 'simple.yml');
            const invalidContent = await loadFixture('invalid', 'invalid-ring.yml');

            await writeToTemp(tempDir, 'valid.yml', validContent);
            await writeToTemp(tempDir, 'invalid.yml', invalidContent);

            const result = await compiler.compile({
                inputPath: tempDir,
                outputPath: outputDir
            });

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0].source).toContain('invalid.yml');
        });
    });
});
