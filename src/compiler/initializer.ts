/**
 * Initializes the output directory as a pnpm + tsup project
 */

import { writeFile, access, mkdir, readFile } from 'fs/promises';
import * as path from 'path';
import { execaCommand } from 'execa';
import { MERLIN_PACKAGE_NAME, MERLIN_PACKAGE_VERSION } from '../common/constants.js';
import { generateDeployScript } from './deploy-script-generator.js';

export interface InitOptions {
    outputPath: string;
    merlinPath: string; // Absolute path to merlin package
}

export interface InitResult {
    initialized: boolean;
    skipped: boolean;
    error?: string;
}

/**
 * Initializes the output directory with package.json and tsup.config.ts
 * Only runs full init if package.json doesn't exist.
 * If package.json exists but uses stale `file:` protocol for merlin,
 * upgrades it to `link:` and re-installs.
 */
export async function initializeOutputDirectory(options: InitOptions): Promise<InitResult> {
    const { outputPath, merlinPath } = options;

    try {
        // Ensure output directory exists
        await mkdir(outputPath, { recursive: true });

        const packageJsonPath = path.join(outputPath, 'package.json');

        // Check if package.json already exists
        const exists = await checkFileExists(packageJsonPath);
        if (exists) {
            // Check if we need to migrate the merlin dependency
            const migrated = await migrateMerlinDependency(packageJsonPath, merlinPath, outputPath);
            return { initialized: migrated, skipped: !migrated };
        }

        // Create package.json
        await createPackageJson(packageJsonPath, merlinPath, outputPath);

        // Create tsup.config.ts
        await createTsupConfig(path.join(outputPath, 'tsup.config.ts'));

        // Create .gitignore
        await createGitignore(path.join(outputPath, '.gitignore'));

        // Create deploy script
        await createDeployScript(path.join(outputPath, 'deploy.ts'));

        // Run pnpm install
        await installDependencies(outputPath);

        return { initialized: true, skipped: false };
    } catch (error) {
        return {
            initialized: false,
            skipped: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Determines the merlin dependency specifier for .merlin/package.json.
 * - npm-installed merlin (inside node_modules): use version specifier e.g. "^0.2.0"
 * - Local development (direct path): use link protocol e.g. "link:.."
 */
function getMerlinDependency(merlinPath: string, outputPath: string): { key: string; value: string } {
    const isNpmInstalled = merlinPath.includes('node_modules');
    if (isNpmInstalled) {
        return {
            key: MERLIN_PACKAGE_NAME,
            value: `^${MERLIN_PACKAGE_VERSION}`
        };
    }
    const relativePath = path.relative(outputPath, merlinPath);
    return {
        key: MERLIN_PACKAGE_NAME,
        value: `link:${relativePath}`
    };
}

async function createPackageJson(filePath: string, merlinPath: string, outputPath: string): Promise<void> {
    const dep = getMerlinDependency(merlinPath, outputPath);
    const packageJson = {
        name: 'merlin-generated',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
            build: 'tsup',
            dev: 'tsup --watch',
            deploy: 'pnpm build && node dist/deploy.js',
            execute: 'pnpm build && node dist/deploy.js --execute'
        },
        dependencies: {
            [dep.key]: dep.value,
            execa: '^9.6.1'
        },
        devDependencies: {
            tsup: '^8.3.5',
            typescript: '^5.7.2'
        }
    };

    await writeFile(filePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
}

async function createTsupConfig(filePath: string): Promise<void> {
    const config = `import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['index.ts', 'deploy.ts'],
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    dts: false,
});
`;

    await writeFile(filePath, config, 'utf-8');
}

async function createGitignore(filePath: string): Promise<void> {
    const content = `node_modules/
dist/
*.tsbuildinfo
`;
    await writeFile(filePath, content, 'utf-8');
}

async function createDeployScript(filePath: string): Promise<void> {
    const content = generateDeployScript();
    await writeFile(filePath, content, 'utf-8');
}

async function installDependencies(cwd: string): Promise<void> {
    await execaCommand('pnpm install', { cwd, stdio: 'pipe' });
}

/**
 * Migrates .merlin/package.json to use the correct merlin dependency.
 * Handles:
 * - Old unscoped "merlin" key → rename to scoped package name
 * - file: protocol → link: protocol
 * - link: to wrong path → correct link: or version specifier
 * - npm-installed merlin → version specifier instead of link:
 */
async function migrateMerlinDependency(
    packageJsonPath: string,
    merlinPath: string,
    outputPath: string
): Promise<boolean> {
    try {
        const raw = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(raw);
        const dep = getMerlinDependency(merlinPath, outputPath);
        let changed = false;

        // Remove old unscoped 'merlin' key if present
        if (pkg.dependencies?.merlin) {
            delete pkg.dependencies.merlin;
            changed = true;
        }

        // Check if current dep matches expected
        const currentRef = pkg.dependencies?.[MERLIN_PACKAGE_NAME];
        if (currentRef !== dep.value) {
            pkg.dependencies = pkg.dependencies ?? {};
            pkg.dependencies[MERLIN_PACKAGE_NAME] = dep.value;
            changed = true;
        }

        if (changed) {
            await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
            await installDependencies(outputPath);
        }

        return changed;
    } catch {
        return false;
    }
}

/**
 * Checks if pnpm is available
 */
export async function checkPnpmAvailable(): Promise<boolean> {
    try {
        await execaCommand('pnpm --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}
