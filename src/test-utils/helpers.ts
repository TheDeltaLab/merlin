/**
 * Shared test utilities for the Merlin compiler test suite
 */

import { readFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { CompilationError } from '../compiler/types.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path helpers
export const FIXTURES_DIR = join(__dirname, 'fixtures');
export const VALID_DIR = join(FIXTURES_DIR, 'valid');
export const INVALID_DIR = join(FIXTURES_DIR, 'invalid');

/**
 * Load a fixture file by name
 */
export async function loadFixture(category: 'valid' | 'invalid', filename: string): Promise<string> {
    const dir = category === 'valid' ? VALID_DIR : INVALID_DIR;
    return readFile(join(dir, filename), 'utf-8');
}

/**
 * Create a temporary directory for test outputs
 */
export async function createTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'merlin-test-'));
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
}

/**
 * Write content to a temporary file
 */
export async function writeToTemp(tempDir: string, filename: string, content: string): Promise<string> {
    const filePath = join(tempDir, filename);
    await writeFile(filePath, content, 'utf-8');
    return filePath;
}

/**
 * Assert that a compilation error contains expected fields
 */
export function assertErrorStructure(error: CompilationError): void {
    expect(error).toHaveProperty('severity');
    expect(error).toHaveProperty('message');
    expect(error).toHaveProperty('source');
    expect(typeof error.message).toBe('string');
}

/**
 * Normalize file paths in generated code for cross-platform testing
 */
export function normalizeGeneratedCode(code: string): string {
    return code
        .replace(/\\/g, '/')
        .replace(/\r\n/g, '\n')
        .trim();
}

/**
 * Normalize paths in error messages for cross-platform testing
 */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}
