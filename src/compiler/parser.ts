/**
 * YAML parser for resource files
 */

import { readFile } from 'fs/promises';
import { parse as parseYAML, YAMLParseError } from 'yaml';
import { ParsedYAML, CompilationError, ErrorSeverity } from './types.js';

/**
 * Parses a YAML file and returns structured data
 */
export async function parseFile(filePath: string): Promise<ParsedYAML> {
    try {
        const content = await readFile(filePath, 'utf-8');
        const data = parseYAML(content, {
            prettyErrors: true
        });

        return {
            source: filePath,
            data
        };
    } catch (error) {
        if (error instanceof YAMLParseError) {
            throw createYAMLSyntaxError(filePath, error);
        }
        throw createFileReadError(filePath, error);
    }
}

/**
 * Creates a compilation error from a YAML parse error
 */
function createYAMLSyntaxError(filePath: string, error: YAMLParseError): CompilationError {
    const linePos = error.linePos?.[0];

    return {
        severity: ErrorSeverity.ERROR,
        message: `YAML syntax error: ${error.message}`,
        source: filePath,
        line: linePos?.line,
        column: linePos?.col,
        hint: 'Check for missing colons, incorrect indentation, or invalid YAML syntax'
    };
}

/**
 * Creates a compilation error from a file read error
 */
function createFileReadError(filePath: string, error: unknown): CompilationError {
    const message = error instanceof Error ? error.message : String(error);

    return {
        severity: ErrorSeverity.ERROR,
        message: `Failed to read file: ${message}`,
        source: filePath,
        hint: 'Ensure the file exists and you have read permissions'
    };
}
