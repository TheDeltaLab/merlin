/**
 * Tests for MD5-based compilation cache
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import {
    computeYAMLHash,
    checkCache,
    writeCacheFile,
    readCacheFile,
    invalidateCache,
    getCacheFilePath,
    CACHE_FILE_NAME
} from '../cache.js';
import { createTempDir, cleanupTempDir, writeToTemp } from '../../test-utils/helpers.js';

describe('Cache', () => {
    let tempDir: string;   // for YAML source files
    let outputDir: string; // for .merlin output

    beforeEach(async () => {
        tempDir = await createTempDir();
        outputDir = await createTempDir();
    });

    afterEach(async () => {
        await cleanupTempDir(tempDir);
        await cleanupTempDir(outputDir);
    });

    // ── computeYAMLHash ──────────────────────────────────────────────────────

    describe('computeYAMLHash', () => {
        it('should return a 32-character hex string (MD5)', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const hash = await computeYAMLHash([file]);
            expect(hash).toMatch(/^[a-f0-9]{32}$/);
        });

        it('should produce the same hash for the same files', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const h1 = await computeYAMLHash([file]);
            const h2 = await computeYAMLHash([file]);
            expect(h1).toBe(h2);
        });

        it('should produce different hashes when file content changes', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const h1 = await computeYAMLHash([file]);
            await writeFile(file, 'name: bar', 'utf-8');
            const h2 = await computeYAMLHash([file]);
            expect(h1).not.toBe(h2);
        });

        it('should produce different hashes when a file is added', async () => {
            const file1 = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const h1 = await computeYAMLHash([file1]);
            const file2 = await writeToTemp(tempDir, 'b.yml', 'name: bar');
            const h2 = await computeYAMLHash([file1, file2]);
            expect(h1).not.toBe(h2);
        });

        it('should produce different hashes when a file is removed', async () => {
            const file1 = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const file2 = await writeToTemp(tempDir, 'b.yml', 'name: bar');
            const h1 = await computeYAMLHash([file1, file2]);
            const h2 = await computeYAMLHash([file1]);
            expect(h1).not.toBe(h2);
        });

        it('should be order-independent (same hash regardless of input array order)', async () => {
            const file1 = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const file2 = await writeToTemp(tempDir, 'b.yml', 'name: bar');
            const h1 = await computeYAMLHash([file1, file2]);
            const h2 = await computeYAMLHash([file2, file1]);
            expect(h1).toBe(h2);
        });

        it('should produce different hashes for different file paths with same content', async () => {
            const file1 = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const file2 = await writeToTemp(tempDir, 'b.yml', 'name: foo'); // same content, different path
            const h1 = await computeYAMLHash([file1]);
            const h2 = await computeYAMLHash([file2]);
            expect(h1).not.toBe(h2);
        });
    });

    // ── writeCacheFile / readCacheFile ───────────────────────────────────────

    describe('writeCacheFile / readCacheFile', () => {
        it('should write and read back a valid cache entry', async () => {
            await writeCacheFile(outputDir, 'abc123', 3);
            const entry = await readCacheFile(outputDir);

            expect(entry).not.toBeNull();
            expect(entry!.hash).toBe('abc123');
            expect(entry!.fileCount).toBe(3);
            expect(entry!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it('should return null when cache file does not exist', async () => {
            const entry = await readCacheFile(outputDir);
            expect(entry).toBeNull();
        });

        it('should return null for malformed JSON', async () => {
            await writeFile(getCacheFilePath(outputDir), 'not-json', 'utf-8');
            const entry = await readCacheFile(outputDir);
            expect(entry).toBeNull();
        });

        it('should return null when JSON is valid but missing required fields', async () => {
            await writeFile(
                getCacheFilePath(outputDir),
                JSON.stringify({ hash: 'abc' }), // missing timestamp and fileCount
                'utf-8'
            );
            const entry = await readCacheFile(outputDir);
            expect(entry).toBeNull();
        });

        it('getCacheFilePath should return the correct path inside outputPath', () => {
            const p = getCacheFilePath('/some/output');
            expect(p).toBe(`/some/output/${CACHE_FILE_NAME}`);
        });
    });

    // ── checkCache ───────────────────────────────────────────────────────────

    describe('checkCache', () => {
        it('should return hit=false when no cache file exists', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const result = await checkCache([file], outputDir);
            expect(result.hit).toBe(false);
            expect(result.entry).toBeNull();
        });

        it('should return hit=true when hash matches', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const hash = await computeYAMLHash([file]);
            await writeCacheFile(outputDir, hash, 1);

            const result = await checkCache([file], outputDir);
            expect(result.hit).toBe(true);
            expect(result.entry).not.toBeNull();
        });

        it('should return hit=false when content changes after cache write', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const hash = await computeYAMLHash([file]);
            await writeCacheFile(outputDir, hash, 1);

            // Mutate the file
            await writeFile(file, 'name: changed', 'utf-8');

            const result = await checkCache([file], outputDir);
            expect(result.hit).toBe(false);
            expect(result.entry).not.toBeNull(); // stale entry is returned
        });

        it('should return hit=false when file list changes', async () => {
            const file1 = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            const hash = await computeYAMLHash([file1]);
            await writeCacheFile(outputDir, hash, 1);

            const file2 = await writeToTemp(tempDir, 'b.yml', 'name: bar');
            const result = await checkCache([file1, file2], outputDir);
            expect(result.hit).toBe(false);
        });

        it('should return hit=false when cache file is corrupt', async () => {
            const file = await writeToTemp(tempDir, 'a.yml', 'name: foo');
            await writeFile(getCacheFilePath(outputDir), 'garbage', 'utf-8');

            const result = await checkCache([file], outputDir);
            expect(result.hit).toBe(false);
            expect(result.entry).toBeNull();
        });
    });

    // ── invalidateCache ──────────────────────────────────────────────────────

    describe('invalidateCache', () => {
        it('should delete generated .ts files (index.ts, resource files)', async () => {
            await writeFile(join(outputDir, 'resource.ts'), 'export const x = 1;', 'utf-8');
            await writeFile(join(outputDir, 'index.ts'), 'export * from "./resource.js"', 'utf-8');

            await invalidateCache(outputDir);

            await expect(access(join(outputDir, 'resource.ts'))).rejects.toThrow();
            await expect(access(join(outputDir, 'index.ts'))).rejects.toThrow();
        });

        it('should delete dist/ directory', async () => {
            const distDir = join(outputDir, 'dist');
            await mkdir(distDir, { recursive: true });
            await writeFile(join(distDir, 'index.js'), 'export {};', 'utf-8');

            await invalidateCache(outputDir);

            await expect(access(distDir)).rejects.toThrow();
        });

        it('should delete the cache file itself', async () => {
            await writeCacheFile(outputDir, 'abc', 1);

            await invalidateCache(outputDir);

            const entry = await readCacheFile(outputDir);
            expect(entry).toBeNull();
        });

        it('should preserve scaffolding files (package.json, tsup.config.ts, deploy.ts)', async () => {
            await writeFile(join(outputDir, 'package.json'), '{}', 'utf-8');
            await writeFile(join(outputDir, 'tsup.config.ts'), 'export default {}', 'utf-8');
            await writeFile(join(outputDir, 'deploy.ts'), '// deploy', 'utf-8');

            await invalidateCache(outputDir);

            await expect(access(join(outputDir, 'package.json'))).resolves.toBeUndefined();
            await expect(access(join(outputDir, 'tsup.config.ts'))).resolves.toBeUndefined();
            await expect(access(join(outputDir, 'deploy.ts'))).resolves.toBeUndefined();
        });

        it('should be a no-op when output directory does not exist', async () => {
            const nonExistentDir = join(tempDir, 'does-not-exist');
            // Should not throw
            await expect(invalidateCache(nonExistentDir)).resolves.toBeUndefined();
        });
    });
});
