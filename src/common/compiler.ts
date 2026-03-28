/**
 * Main compiler orchestrator
 */

import { readdir, mkdir, writeFile, stat, access } from 'fs/promises';
import * as path from 'path';
import { parseFile } from '../compiler/parser.js';
import { validate } from '../compiler/validator.js';
import { expand } from '../compiler/transformer.js';
import { generate, generateIndex } from '../compiler/generator.js';
import {
    CompilerOptions,
    CompilationResult,
    CompilationError,
    ErrorSeverity,
    ParsedYAML,
    ResourceYAML,
    ExpandedResource,
    GeneratedFile
} from '../compiler/types.js';
import { initializeOutputDirectory, checkPnpmAvailable } from '../compiler/initializer.js';
import { computeYAMLHash, checkCache, writeCacheFile, invalidateCache } from '../compiler/cache.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execaCommand } from 'execa';

/**
 * Main compiler class
 */
export class Compiler {
    /**
     * Compiles YAML resources to TypeScript
     */
    async compile(options: CompilerOptions): Promise<CompilationResult> {
        const errors: CompilationError[] = [];
        const warnings: CompilationError[] = [];
        const generatedFiles: string[] = [];

        try {
            // 1. Discover YAML files (auto-include shared resources from merlin package)
            const sharedPaths = options.noShared ? [] : await this.getSharedResourcePaths();
            const allInputPaths = [options.inputPath, ...(options.inputPaths ?? []), ...sharedPaths];
            const yamlFileArrays = await Promise.all(allInputPaths.map(p => this.discoverYAMLFiles(p)));
            const yamlFiles = [...new Set(yamlFileArrays.flat())];
            if (yamlFiles.length === 0) {
                return this.createNoFilesError(options.inputPath);
            }

            // 1.5. Cache check: skip expensive compilation if no YAML files changed
            if (!options.validate && !options.skipCache) {
                const cacheResult = await checkCache(yamlFiles, options.outputPath);
                if (cacheResult.hit) {
                    return { success: true, errors: [], warnings: [], generatedFiles: [], cacheHit: true };
                }
                // Cache miss: clean stale generated artifacts before recompiling
                await invalidateCache(options.outputPath);
            }

            // 2. Parse all files
            const parsedFiles = await this.parseAllFiles(yamlFiles, errors);
            if (parsedFiles.length === 0) {
                return { success: false, errors, warnings, generatedFiles };
            }

            // 3. Validate all files
            const validatedResources = this.validateAllFiles(parsedFiles, errors, warnings);
            if (errors.length > 0) {
                return { success: false, errors, warnings, generatedFiles };
            }

            // If validation-only mode, stop here
            if (options.validate) {
                return { success: true, errors, warnings, generatedFiles };
            }

            // 3.5. Initialize output directory (if needed)
            const pnpmAvailable = await checkPnpmAvailable();
            if (!pnpmAvailable) {
                warnings.push({
                    severity: ErrorSeverity.WARNING,
                    message: 'pnpm not found - skipping project initialization',
                    source: options.outputPath,
                    hint: 'Install pnpm globally: npm install -g pnpm'
                });
            } else {
                const merlinPath = this.getMerlinPath();
                const initResult = await initializeOutputDirectory({
                    outputPath: options.outputPath,
                    merlinPath
                });

                if (initResult.error) {
                    warnings.push({
                        severity: ErrorSeverity.WARNING,
                        message: `Failed to initialize: ${initResult.error}`,
                        source: options.outputPath,
                        hint: 'You may need to manually set up package.json'
                    });
                }
            }

            // 4. Transform resources (expand ring/region)
            const expandedResources = this.transformResources(validatedResources);

            // 5. Generate TypeScript code
            const generated = this.generateCode(expandedResources);

            // 6. Write all files to disk
            await this.writeGeneratedFiles(generated, options.outputPath, generatedFiles);

            // 7. Build generated code (if pnpm available)
            if (pnpmAvailable) {
                const buildResult = await this.buildGeneratedCode(options.outputPath);
                if (!buildResult.success) {
                    warnings.push({
                        severity: ErrorSeverity.WARNING,
                        message: `Build failed: ${buildResult.error}`,
                        source: options.outputPath,
                        hint: 'Check generated code for errors'
                    });
                }
            }

            // 8. Write cache file after full successful compilation
            if (!options.skipCache) {
                const hash = await computeYAMLHash(yamlFiles);
                await writeCacheFile(options.outputPath, hash, yamlFiles.length);
            }

            return { success: true, errors, warnings, generatedFiles };

        } catch (error) {
            errors.push(this.createUnexpectedError(options.inputPath, error));
            return { success: false, errors, warnings, generatedFiles };
        }
    }

    /**
     * Watch mode (to be implemented in Phase 5)
     */
    async watch(options: CompilerOptions): Promise<void> {
        throw new Error('Watch mode not yet implemented');
    }

    /**
     * Parses all YAML files in parallel
     */
    private async parseAllFiles(
        yamlFiles: string[],
        errors: CompilationError[]
    ): Promise<ParsedYAML[]> {
        const parseResults = await Promise.allSettled(
            yamlFiles.map(file => parseFile(file))
        );

        const parsedFiles: ParsedYAML[] = [];
        for (const result of parseResults) {
            if (result.status === 'fulfilled') {
                parsedFiles.push(result.value);
            } else {
                errors.push(result.reason);
            }
        }

        return parsedFiles;
    }

    /**
     * Validates all parsed files
     */
    private validateAllFiles(
        parsedFiles: ParsedYAML[],
        errors: CompilationError[],
        warnings: CompilationError[]
    ): Array<{ source: string; data: ResourceYAML }> {
        const validateResults = parsedFiles.map(parsed => validate(parsed));

        const validatedResources: Array<{ source: string; data: ResourceYAML }> = [];
        for (let i = 0; i < validateResults.length; i++) {
            const result = validateResults[i];
            const parsed = parsedFiles[i];

            errors.push(...result.errors.filter(e => e.severity === ErrorSeverity.ERROR));
            warnings.push(...result.errors.filter(e => e.severity === ErrorSeverity.WARNING));

            if (result.valid && result.data) {
                validatedResources.push({ source: parsed.source, data: result.data });
            }
        }

        return validatedResources;
    }

    /**
     * Transforms resources by expanding ring/region combinations
     */
    private transformResources(
        validatedResources: Array<{ source: string; data: ResourceYAML }>
    ): Array<{ source: string; resources: ExpandedResource[] }> {
        return validatedResources.map(({ source, data }) => ({
            source,
            resources: expand(data)
        }));
    }

    /**
     * Generates TypeScript code for all resources
     */
    private generateCode(
        expandedResources: Array<{ source: string; resources: ExpandedResource[] }>
    ): GeneratedFile[] {
        return expandedResources.map(({ source, resources }) =>
            generate(source, resources)
        );
    }

    /**
     * Writes all generated files to disk
     */
    private async writeGeneratedFiles(
        generated: GeneratedFile[],
        outputPath: string,
        generatedFiles: string[]
    ): Promise<void> {
        // Create output directory
        await mkdir(outputPath, { recursive: true });

        // Write all generated files in parallel
        await Promise.all(
            generated.map(async (file) => {
                const filePath = path.join(outputPath, file.fileName);
                await writeFile(filePath, file.content, 'utf-8');
                generatedFiles.push(filePath);
            })
        );

        // Generate and write index.ts
        const indexFile = generateIndex(generated);
        const indexPath = path.join(outputPath, indexFile.fileName);
        await writeFile(indexPath, indexFile.content, 'utf-8');
        generatedFiles.push(indexPath);
    }

    /**
     * Creates an error for no files found
     */
    private createNoFilesError(inputPath: string): CompilationResult {
        return {
            success: false,
            errors: [{
                severity: ErrorSeverity.ERROR,
                message: 'No YAML files found',
                source: inputPath,
                hint: 'Ensure the path contains .yml files'
            }],
            warnings: [],
            generatedFiles: []
        };
    }

    /**
     * Creates an error for unexpected errors
     */
    private createUnexpectedError(inputPath: string, error: unknown): CompilationError {
        return {
            severity: ErrorSeverity.ERROR,
            message: error instanceof Error ? error.message : String(error),
            source: inputPath,
            hint: 'An unexpected error occurred during compilation'
        };
    }

    /**
     * Discovers all YAML files in the input path
     */
    private async discoverYAMLFiles(inputPath: string): Promise<string[]> {
        const stats = await stat(inputPath);

        if (stats.isFile()) {
            return this.handleSingleFile(inputPath);
        }

        if (stats.isDirectory()) {
            return this.findYAMLFilesRecursive(inputPath);
        }

        return [];
    }

    /**
     * Handles a single file input
     */
    private handleSingleFile(filePath: string): string[] {
        if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
            return [filePath];
        }
        return [];
    }

    /**
     * Recursively finds all YAML files in a directory
     */
    private async findYAMLFilesRecursive(dir: string): Promise<string[]> {
        const files: string[] = [];
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (this.shouldScanDirectory(entry.name)) {
                    const subFiles = await this.findYAMLFilesRecursive(fullPath);
                    files.push(...subFiles);
                }
            } else if (this.isYAMLFile(entry.name)) {
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Checks if a directory should be scanned
     */
    private shouldScanDirectory(name: string): boolean {
        return !name.startsWith('.') && name !== 'node_modules';
    }

    /**
     * Checks if a file is a YAML file
     */
    private isYAMLFile(name: string): boolean {
        return name.endsWith('.yml') || name.endsWith('.yaml');
    }

    /**
     * Returns paths to shared resource directories bundled with the merlin package.
     * Only includes directories that actually exist on disk.
     */
    private async getSharedResourcePaths(): Promise<string[]> {
        const merlinRoot = this.getMerlinPath();
        const candidates = [
            path.join(merlinRoot, 'shared-resource'),
            path.join(merlinRoot, 'shared-k8s-resource'),
        ];

        const results = await Promise.all(
            candidates.map(async (dir) => {
                try {
                    const s = await stat(dir);
                    return s.isDirectory() ? dir : null;
                } catch {
                    return null;
                }
            })
        );

        return results.filter((d): d is string => d !== null);
    }

    /**
     * Gets the absolute path to the merlin package root
     */
    private getMerlinPath(): string {
        const currentFileUrl = import.meta.url;
        const currentFilePath = fileURLToPath(currentFileUrl);
        const currentDir = dirname(currentFilePath);
        // Navigate up from dist/ to project root
        // In built code: dist/merlin.js (or dist/chunk-*.js) -> ../ -> project root
        return path.resolve(currentDir, '..');
    }

    /**
     * Builds the generated TypeScript code using tsup
     */
    private async buildGeneratedCode(outputPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            // Verify package.json exists
            const packageJsonPath = path.join(outputPath, 'package.json');
            const exists = await access(packageJsonPath)
                .then(() => true)
                .catch(() => false);

            if (!exists) {
                return {
                    success: false,
                    error: 'package.json not found - run initialization first'
                };
            }

            // Run pnpm build
            await execaCommand('pnpm build', {
                cwd: outputPath,
                stdio: 'pipe' // Suppress output unless error
            });

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }
}
