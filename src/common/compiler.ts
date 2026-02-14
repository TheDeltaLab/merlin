/**
 * Main compiler orchestrator
 */

import { readdir, mkdir, writeFile, stat } from 'fs/promises';
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
            // 1. Discover YAML files
            const yamlFiles = await this.discoverYAMLFiles(options.inputPath);
            if (yamlFiles.length === 0) {
                return this.createNoFilesError(options.inputPath);
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

            // 4. Transform resources (expand ring/region)
            const expandedResources = this.transformResources(validatedResources);

            // 5. Generate TypeScript code
            const generated = this.generateCode(expandedResources);

            // 6. Write all files to disk
            await this.writeGeneratedFiles(generated, options.outputPath, generatedFiles);

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
}
