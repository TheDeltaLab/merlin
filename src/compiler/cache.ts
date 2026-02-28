/**
 * MD5-based compilation cache for the Merlin compiler.
 *
 * Cache file location: <outputPath>/.merlin-cache
 * Cache is invalidated when any YAML file path or content changes.
 */

import { createHash } from 'crypto';
import { readFile, writeFile, readdir, rm } from 'fs/promises';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry {
    /** MD5 hex digest of all YAML file paths + contents */
    hash: string;
    /** ISO timestamp of when this cache entry was written */
    timestamp: string;
    /** Number of YAML files that were compiled */
    fileCount: number;
}

export interface CacheCheckResult {
    /** true if the cache is valid and compilation can be skipped */
    hit: boolean;
    /** The stored entry, or null if cache file doesn't exist / is corrupt */
    entry: CacheEntry | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const CACHE_FILE_NAME = '.merlin-cache';

// ── Hash computation ─────────────────────────────────────────────────────────

/**
 * Computes an MD5 hash over all YAML file paths and their contents.
 *
 * Algorithm:
 *   1. Sort file paths alphabetically (for determinism across OSes/runs)
 *   2. For each file, read its contents and feed "<path>\n<content>\n" to
 *      a running hasher (no giant in-memory string needed)
 *   3. Return the final hex digest
 *
 * Covering file paths ensures that adding, removing, or renaming any YAML
 * file triggers a cache miss, not just content edits.
 */
export async function computeYAMLHash(yamlFiles: string[]): Promise<string> {
    const hasher = createHash('md5');
    const sorted = [...yamlFiles].sort();

    for (const filePath of sorted) {
        const content = await readFile(filePath, 'utf-8');
        hasher.update(filePath);
        hasher.update('\n');
        hasher.update(content);
        hasher.update('\n');
    }

    return hasher.digest('hex');
}

// ── Cache file I/O ───────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the cache file for a given output directory.
 */
export function getCacheFilePath(outputPath: string): string {
    return path.join(outputPath, CACHE_FILE_NAME);
}

/**
 * Reads and parses the cache file.
 * Returns null if the file doesn't exist, is empty, or is malformed.
 */
export async function readCacheFile(outputPath: string): Promise<CacheEntry | null> {
    try {
        const raw = await readFile(getCacheFilePath(outputPath), 'utf-8');
        const parsed = JSON.parse(raw) as unknown;

        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as Record<string, unknown>).hash === 'string' &&
            typeof (parsed as Record<string, unknown>).timestamp === 'string' &&
            typeof (parsed as Record<string, unknown>).fileCount === 'number'
        ) {
            return parsed as CacheEntry;
        }

        return null; // Malformed
    } catch {
        return null; // File missing or unreadable
    }
}

/**
 * Writes the cache file to disk.
 * The output directory is expected to already exist.
 */
export async function writeCacheFile(outputPath: string, hash: string, fileCount: number): Promise<void> {
    const entry: CacheEntry = {
        hash,
        timestamp: new Date().toISOString(),
        fileCount
    };

    await writeFile(
        getCacheFilePath(outputPath),
        JSON.stringify(entry, null, 2) + '\n',
        'utf-8'
    );
}

// ── Cache check ──────────────────────────────────────────────────────────────

/**
 * Checks whether the cache is valid for the given set of YAML files.
 *
 * Returns { hit: true } if the stored hash matches the current YAML content,
 * meaning compilation can be skipped entirely.
 */
export async function checkCache(
    yamlFiles: string[],
    outputPath: string
): Promise<CacheCheckResult> {
    const stored = await readCacheFile(outputPath);

    if (!stored) {
        return { hit: false, entry: null };
    }

    const current = await computeYAMLHash(yamlFiles);

    return { hit: current === stored.hash, entry: stored };
}

// ── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Cleans generated artifacts from the output directory without touching the
 * project scaffolding (package.json, node_modules, tsup.config.ts, etc.).
 *
 * Files removed:
 *   - All *.ts files in outputPath root that are generated (not scaffolding)
 *   - dist/ subdirectory (compiled JS output)
 *   - .merlin-cache (the stale cache file itself)
 *
 * Files preserved (so pnpm install is not re-run):
 *   - package.json
 *   - pnpm-lock.yaml
 *   - node_modules/
 *   - tsup.config.ts
 *   - deploy.ts
 *   - .gitignore
 */
export async function invalidateCache(outputPath: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
        entries = await readdir(outputPath, { withFileTypes: true });
    } catch {
        return; // outputPath doesn't exist yet — nothing to clean
    }

    // Delete generated .ts files (not scaffolding files)
    const tsFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.ts') && isGeneratedTsFile(e.name))
        .map(e => path.join(outputPath, e.name));

    await Promise.all(tsFiles.map(f => rm(f, { force: true })));

    // Delete dist/ directory
    await rm(path.join(outputPath, 'dist'), { recursive: true, force: true });

    // Delete stale cache file
    await rm(getCacheFilePath(outputPath), { force: true });
}

/**
 * Returns true for *.ts files that Merlin generates (not scaffolding).
 *
 * Scaffolding files to preserve:
 *   - tsup.config.ts
 *   - deploy.ts
 */
function isGeneratedTsFile(name: string): boolean {
    return name !== 'tsup.config.ts' && name !== 'deploy.ts';
}
