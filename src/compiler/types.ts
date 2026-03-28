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
    authProvider?: AuthProviderRef;
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

// ── Parameter interpolation types ───────────────────────────────────────────

/**
 * A single segment of a parameterized string value.
 *
 * A string like "${ AzureContainerRegistry.chuangacr.server }/myapp:latest" is parsed into:
 *   [ { type: 'dep', resourceType: 'AzureContainerRegistry', resource: 'chuangacr', export: 'server' },
 *     { type: 'literal', value: '/myapp:latest' } ]
 */
export type ParamSegment =
    | { type: 'literal'; value: string }
    | { type: 'dep'; resourceType: string; resource: string; export: string }   // ${ Type.name.exportKey }
    | { type: 'self'; field: 'ring' | 'region' };          // ${ this.ring } | ${ this.region }

/**
 * A parameterized string value: an ordered list of segments that concatenate to the final string.
 * Only used for STRING config values that contain at least one ${ } expression.
 * Non-string config values (numbers, booleans, objects, arrays) are never wrapped.
 */
export interface ParamValue {
    /** Brand sentinel — survives JSON serialization so the runtime resolver can identify this. */
    __merlin_param__: true;
    segments: ParamSegment[];
}

/**
 * Type guard for ParamValue
 */
export function isParamValue(v: unknown): v is ParamValue {
    return (
        typeof v === 'object' &&
        v !== null &&
        (v as Record<string, unknown>).__merlin_param__ === true
    );
}

// ── Compiler options ─────────────────────────────────────────────────────────

/**
 * Compiler options
 */
export interface CompilerOptions {
    inputPath: string;        // YAML file or directory (primary; use inputPaths for multiple)
    inputPaths?: string[];    // Additional YAML files or directories to compile alongside inputPath
    outputPath: string;       // Output directory (default: .merlin)
    watch?: boolean;          // Enable watch mode
    validate?: boolean;       // Validation-only mode (don't generate)
    skipCache?: boolean;      // Skip cache check and write (--no-cache flag)
    noShared?: boolean;       // Skip auto-including shared resources from the merlin package
}

/**
 * Compilation result
 */
export interface CompilationResult {
    success: boolean;
    errors: CompilationError[];
    warnings: CompilationError[];
    generatedFiles: string[];
    cacheHit?: boolean;       // true when compilation was skipped due to cache hit
}
