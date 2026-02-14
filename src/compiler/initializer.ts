/**
 * Initializes the output directory as a pnpm + tsup project
 */

import { writeFile, access, mkdir, readFile, copyFile } from 'fs/promises';
import * as path from 'path';
import { execaCommand } from 'execa';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
 * Only runs if package.json doesn't exist
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
            return { initialized: false, skipped: true };
        }

        // Calculate relative path from outputPath to merlinPath
        const relativeMerlinPath = path.relative(outputPath, merlinPath);

        // Create package.json
        await createPackageJson(packageJsonPath, relativeMerlinPath);

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

async function createPackageJson(filePath: string, relativeMerlinPath: string): Promise<void> {
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
            merlin: `file:${relativeMerlinPath}`,
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
    // Get the path to the template file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // After bundling, __dirname will be dist/
    // Templates are copied to dist/compiler/templates/
    const templatePath = path.join(__dirname, 'compiler', 'templates', 'deploy-script.ts.template');

    // Copy the template file directly
    await copyFile(templatePath, filePath);
}

async function installDependencies(cwd: string): Promise<void> {
    await execaCommand('pnpm install', { cwd, stdio: 'pipe' });
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
