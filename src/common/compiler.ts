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

/**
 * Options for the list command (extends compile options with filters)
 */
export interface ListOptions {
    inputPath: string;
    inputPaths?: string[];
    noShared?: boolean;
    ring?: string;
    region?: string;
}
import { initializeOutputDirectory, checkPnpmAvailable } from '../compiler/initializer.js';
import { computeYAMLHash, checkCache, writeCacheFile, invalidateCache } from '../compiler/cache.js';
import { loadProjectConfig, applyProjectDefaults, ProjectConfig } from '../compiler/projectConfig.js';
import { expandKubernetesApp } from '../compiler/kubernetesAppExpander.js';
import { KUBERNETES_APP_TYPE } from '../compiler/schemas.js';
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
            // 1. Discover YAML files (always include shared resources for ${ } resolution)
            const sharedPaths = await this.getSharedResourcePaths();
            const allInputPaths = [options.inputPath, ...(options.inputPaths ?? []), ...sharedPaths];
            const yamlFileArrays = await Promise.all(allInputPaths.map(p => this.discoverYAMLFiles(p)));
            const yamlFiles = [...new Set(yamlFileArrays.flat())];

            // Track which files came from shared directories (for --no-shared deploy filtering)
            const sharedFileArrays = await Promise.all(sharedPaths.map(p => this.discoverYAMLFiles(p)));
            const sharedFiles = new Set(sharedFileArrays.flat());
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

            // 2.5. Discover project configs (merlin.yml) and apply defaults
            const inputDirs = this.getUniqueDirs(parsedFiles);
            const projectConfigMap = this.discoverProjectConfigs(inputDirs);
            const filesWithDefaults = this.applyProjectDefaultsToAll(parsedFiles, projectConfigMap);

            // 3. Validate all files
            const validatedResources = this.validateAllFiles(filesWithDefaults, errors, warnings);
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

            // 4. Expand composite resource types (e.g. KubernetesApp → Deployment + Service + Ingress)
            const expandedYAMLs = this.expandCompositeResources(validatedResources);

            // 5. Transform resources (expand ring/region)
            const expandedResources = this.transformResources(expandedYAMLs);

            // 5.5. Mark shared resources (from shared-resource/ and shared-k8s-resource/)
            for (const entry of expandedResources) {
                if (sharedFiles.has(entry.source)) {
                    for (const r of entry.resources) {
                        r._isShared = true;
                    }
                }
            }

            // 5.6. Merge resources from the same source file (e.g. KubernetesApp expands
            // into multiple resource types, all originating from the same YAML file)
            const mergedResources = this.mergeBySource(expandedResources);

            // 6. Generate TypeScript code
            const generated = this.generateCode(mergedResources);

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
     * Lists all resources after expansion (no code generation or build).
     * Reuses compile pipeline steps 1-5, then filters by ring/region.
     */
    async list(options: ListOptions): Promise<ExpandedResource[]> {
        // 1. Discover YAML files (always include shared for ${ } resolution)
        const sharedPaths = await this.getSharedResourcePaths();
        const allInputPaths = [options.inputPath, ...(options.inputPaths ?? []), ...sharedPaths];
        const yamlFileArrays = await Promise.all(allInputPaths.map(p => this.discoverYAMLFiles(p)));
        const yamlFiles = [...new Set(yamlFileArrays.flat())];
        if (yamlFiles.length === 0) return [];

        // 2. Parse
        const errors: CompilationError[] = [];
        const parsedFiles = await this.parseAllFiles(yamlFiles, errors);
        if (parsedFiles.length === 0) return [];

        // 2.5. Project defaults
        const inputDirs = this.getUniqueDirs(parsedFiles);
        const projectConfigMap = this.discoverProjectConfigs(inputDirs);
        const filesWithDefaults = this.applyProjectDefaultsToAll(parsedFiles, projectConfigMap);

        // 3. Validate
        const warnings: CompilationError[] = [];
        const validatedResources = this.validateAllFiles(filesWithDefaults, errors, warnings);
        if (errors.length > 0) {
            throw new Error(errors.map(e => e.message).join('\n'));
        }

        // 4. Expand composite types (KubernetesApp → Deployment + Service + Ingress)
        const expandedYAMLs = this.expandCompositeResources(validatedResources);

        // 5. Transform (ring × region cartesian product)
        const expandedResources = this.transformResources(expandedYAMLs);
        const merged = this.mergeBySource(expandedResources);
        let allResources = merged.flatMap(m => m.resources);

        // 6. Filter by ring/region (resources with no ring/region are global — always included)
        if (options.ring) {
            allResources = allResources.filter(r => r.ring === undefined || r.ring === options.ring);
        }
        if (options.region) {
            allResources = allResources.filter(r => r.region === undefined || r.region === options.region);
        }

        return allResources;
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
     * Extracts unique directory paths from parsed files
     */
    private getUniqueDirs(parsedFiles: ParsedYAML[]): string[] {
        const dirs = new Set(parsedFiles.map(p => path.dirname(p.source)));
        return [...dirs];
    }

    /**
     * Merges expanded resources that share the same source file.
     * This is needed after composite type expansion (e.g. KubernetesApp → Deployment + Service + Ingress)
     * where multiple resource entries originate from the same YAML file and must be written to one .ts file.
     */
    private mergeBySource(
        resources: Array<{ source: string; resources: ExpandedResource[] }>
    ): Array<{ source: string; resources: ExpandedResource[] }> {
        const map = new Map<string, ExpandedResource[]>();
        for (const { source, resources: res } of resources) {
            const existing = map.get(source);
            if (existing) {
                existing.push(...res);
            } else {
                map.set(source, [...res]);
            }
        }
        return [...map.entries()].map(([source, resources]) => ({ source, resources }));
    }

    /**
     * Discovers merlin.yml project configs in each directory
     */
    private discoverProjectConfigs(dirs: string[]): Map<string, ProjectConfig> {
        const configMap = new Map<string, ProjectConfig>();
        for (const dir of dirs) {
            const config = loadProjectConfig(dir);
            if (config) {
                configMap.set(dir, config);
            }
        }
        return configMap;
    }

    /**
     * Applies project-level defaults from merlin.yml to all parsed files.
     * Resource-level fields take precedence over project defaults.
     */
    private applyProjectDefaultsToAll(
        parsedFiles: ParsedYAML[],
        projectConfigMap: Map<string, ProjectConfig>
    ): ParsedYAML[] {
        return parsedFiles.map(parsed => {
            const dir = path.dirname(parsed.source);
            const projectConfig = projectConfigMap.get(dir);
            if (!projectConfig) return parsed;

            const data = parsed.data as Record<string, unknown>;
            return {
                ...parsed,
                data: applyProjectDefaults(data, projectConfig),
            };
        });
    }

    /**
     * Expands composite resource types (e.g. KubernetesApp) into standard resources.
     * This runs after validation but before ring/region expansion.
     */
    private expandCompositeResources(
        resources: Array<{ source: string; data: ResourceYAML }>
    ): Array<{ source: string; data: ResourceYAML }> {
        const result: Array<{ source: string; data: ResourceYAML }> = [];
        for (const { source, data } of resources) {
            if (data.type === KUBERNETES_APP_TYPE) {
                const expanded = expandKubernetesApp(data);
                result.push(...expanded.map(r => ({ source, data: r })));
            } else {
                result.push({ source, data });
            }
        }
        return result;
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
        const name = path.basename(filePath);
        if (name === 'merlin.yml' || name === 'merlin.yaml') return [];
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
     * Checks if a file is a YAML resource file (excludes merlin.yml project config)
     */
    private isYAMLFile(name: string): boolean {
        if (name === 'merlin.yml' || name === 'merlin.yaml') return false;
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
