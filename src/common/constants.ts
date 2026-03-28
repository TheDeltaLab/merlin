/**
 * Package-level constants shared across the compiler and runtime.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
