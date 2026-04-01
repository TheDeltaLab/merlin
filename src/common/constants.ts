/**
 * Package-level constants shared across the compiler and runtime.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execa } from 'execa';

/** The npm package name used in generated import specifiers and .merlin/package.json. */
export const MERLIN_PACKAGE_NAME = '@thedeltalab/merlin';

/**
 * Reads the merlin package version from its own package.json.
 * After bundling, __dirname resolves to dist/ — one level below the package root.
 */
function readPackageVersion(): string {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const pkgPath = join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return pkg.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/** The current merlin package version (e.g. "0.2.0"). */
export const MERLIN_PACKAGE_VERSION = readPackageVersion();

/**
 * Placeholder in command args that is replaced at execution time with the path
 * to a temporary YAML file whose content is specified via `Command.fileContent`.
 * Used by Kubernetes renders and the deployer.
 */
export const MERLIN_YAML_FILE_PLACEHOLDER = '__MERLIN_YAML_FILE__';

/**
 * Convert a string to an uppercase slug suitable for shell variable names.
 * Replaces all non-alphanumeric characters with underscores.
 *
 * Example: "my-resource.staging" → "MY_RESOURCE_STAGING"
 */
export function toEnvSlug(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Azure CLI exit codes and error strings used to detect "resource not found".
 * Used by getDeployedProps in all Azure resource renders.
 */
export const NOT_FOUND_EXIT_CODES = [1, 3] as const;
export const NOT_FOUND_PATTERNS = [
    'ResourceNotFound',
    'ResourceGroupNotFound',
    'was not found',
    'could not be found',
] as const;

/**
 * Check if an error from exec (Azure CLI) indicates that the resource
 * does not exist. Returns true if the error matches known "not found" patterns.
 *
 * @param error - The error thrown by execAsync or execSync
 * @returns true if the error indicates the resource was not found
 */
export function isResourceNotFoundError(error: any): boolean {
    if (NOT_FOUND_EXIT_CODES.includes(error.status)) {
        return true;
    }

    const errorMessage = error.message || String(error);
    const stderr = error.stderr?.toString() || '';
    const combinedError = errorMessage + ' ' + stderr;

    return NOT_FOUND_PATTERNS.some(pattern => combinedError.includes(pattern));
}

/**
 * Execute a shell command asynchronously and return stdout.
 * Equivalent to execSync but non-blocking.
 * Stderr is suppressed (piped but not printed).
 */
export async function execAsync(command: string, args: string[]): Promise<string> {
    const result = await execa(command, args, {
        reject: false,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
        const error: any = new Error(`Command failed: ${command} ${args.join(' ')}`);
        error.status = result.exitCode;
        error.stderr = result.stderr;
        error.message = result.stderr || result.stdout || error.message;
        throw error;
    }
    return result.stdout;
}
