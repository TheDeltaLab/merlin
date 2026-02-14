/**
 * Compiler-specific types and interfaces
 */

import { Ring, Region } from '../common/resource.js';
import type { ResourceYAML } from './schemas.js';

// Re-export ResourceYAML for convenience
export type { ResourceYAML };

/**
 * Dependency in YAML format (compile-time)
 */
export interface DependencyYAML {
    resource: string;
    isHardDependency?: boolean;
    authProvider?: AuthProviderYAML;
}

/**
 * AuthProvider in YAML format (compile-time)
 */
export interface AuthProviderYAML {
    name: string;
    [key: string]: string;  // All arguments must be strings
}

/**
 * Export in YAML format (compile-time) - can be string or object
 */
export type ExportYAML = string | {
    name: string;
    [key: string]: string;  // All arguments must be strings
};

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    ERROR = 'error',
    WARNING = 'warning',
    INFO = 'info'
}

/**
 * Compilation error with source location
 */
export interface CompilationError {
    severity: ErrorSeverity;
    message: string;
    source: string;        // File path
    path?: string;         // YAML path (e.g., "ring[0]", "authProvider.name")
    line?: number;
    column?: number;
    hint?: string;         // Suggestion to fix
}

/**
 * Parsed YAML with source information
 */
export interface ParsedYAML {
    source: string;           // Original file path
    data: unknown;            // Parsed YAML data
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    data?: ResourceYAML;      // Typed and validated data
    errors: CompilationError[];
}

/**
 * Expanded resource (one per ring+region combination)
 */
export interface ExpandedResource {
    name: string;
    ring: Ring;              // Single value
    region?: Region;         // Single value or undefined
    type: string;
    project?: string;
    parent?: string;
    authProvider: AuthProviderRef;
    dependencies: DependencyYAML[];  // Use YAML format, not runtime Dependency
    config: Record<string, unknown>;  // Merged defaultConfig + specificConfig
    exports: Record<string, ExportRef>;
}

/**
 * Export reference for generated code
 */
export interface ExportRef {
    name: string;            // The ProprietyGetter name
    args: Record<string, string>;
}

/**
 * AuthProvider reference for generated code
 */
export interface AuthProviderRef {
    name: string;
    args: Record<string, string>;
}

/**
 * Generated TypeScript file
 */
export interface GeneratedFile {
    fileName: string;         // e.g., "abs.ts"
    content: string;          // Generated TypeScript code
    resources: string[];      // Exported resource names
}

/**
 * Compiler options
 */
export interface CompilerOptions {
    inputPath: string;        // YAML file or directory
    outputPath: string;       // Output directory (default: .merlin)
    watch?: boolean;          // Enable watch mode
    validate?: boolean;       // Validation-only mode (don't generate)
}

/**
 * Compilation result
 */
export interface CompilationResult {
    success: boolean;
    errors: CompilationError[];
    warnings: CompilationError[];
    generatedFiles: string[];
}
