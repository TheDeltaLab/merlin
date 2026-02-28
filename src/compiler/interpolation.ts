/**
 * Compile-time parameter interpolation parser.
 *
 * Parses ${ ... } expressions in YAML config string values and converts them
 * into structured ParamValue objects for runtime resolution.
 */

import { ParamSegment, ParamValue } from './types.js';

// Matches ${ ... } with optional leading/trailing whitespace inside braces
const PARAM_PATTERN = /\$\{\s*([^}]+?)\s*\}/g;

/**
 * Parse a string that may contain ${ ... } expressions.
 * Returns a ParamValue if any expressions are found, otherwise returns null
 * (caller should keep the original string unchanged).
 *
 * Supported expression forms:
 *   ${ this.ring }                → { type: 'self', field: 'ring' }
 *   ${ this.region }              → { type: 'self', field: 'region' }
 *   ${ Type.name.export }         → { type: 'dep', resourceType: 'Type', resource: 'name', export: 'export' }
 *
 * @throws Error for unrecognized expression syntax
 */
export function parseParamString(value: string): ParamValue | null {
    const segments: ParamSegment[] = [];
    let lastIndex = 0;
    let hasParam = false;

    // Reset regex state before use (pattern has 'g' flag, so lastIndex persists)
    PARAM_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = PARAM_PATTERN.exec(value)) !== null) {
        hasParam = true;
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        const expression = match[1].trim();

        // Add literal segment for text before this match
        if (matchStart > lastIndex) {
            segments.push({ type: 'literal', value: value.slice(lastIndex, matchStart) });
        }

        // Parse the inner expression
        segments.push(parseExpression(expression));

        lastIndex = matchEnd;
    }

    if (!hasParam) {
        return null;
    }

    // Add trailing literal segment after the last expression
    if (lastIndex < value.length) {
        segments.push({ type: 'literal', value: value.slice(lastIndex) });
    }

    return { __merlin_param__: true, segments };
}

/**
 * Parse a single expression inside ${ }
 * Supports: this.ring, this.region, Type.name.exportKey
 * @throws Error for unrecognized syntax
 */
function parseExpression(expr: string): ParamSegment {
    // this.ring
    if (expr === 'this.ring') {
        return { type: 'self', field: 'ring' };
    }

    // this.region
    if (expr === 'this.region') {
        return { type: 'self', field: 'region' };
    }

    // Type.name.exportKey — must have exactly two dots
    const firstDot = expr.indexOf('.');
    if (firstDot > 0) {
        const secondDot = expr.indexOf('.', firstDot + 1);
        if (secondDot > firstDot + 1 && secondDot < expr.length - 1) {
            const resourceType = expr.slice(0, firstDot).trim();
            const resource = expr.slice(firstDot + 1, secondDot).trim();
            const exportKey = expr.slice(secondDot + 1).trim();
            if (
                resourceType && resource && exportKey &&
                !resourceType.includes(' ') &&
                !resource.includes(' ') &&
                !exportKey.includes(' ')
            ) {
                return { type: 'dep', resourceType, resource, export: exportKey };
            }
        }
    }

    throw new Error(
        `Invalid parameter expression: "\${ ${expr} }". ` +
        `Expected "this.ring", "this.region", or "<Type>.<name>.<exportKey>".`
    );
}

/**
 * Walk a config object recursively and replace all string values containing
 * ${ } expressions with ParamValue objects.
 *
 * Non-string values (numbers, booleans, null, objects, arrays) are traversed
 * but never wrapped themselves — only string leaf values are transformed.
 */
export function parseConfigParams(
    config: Record<string, unknown>
): Record<string, unknown> {
    return walkValue(config) as Record<string, unknown>;
}

function walkValue(value: unknown): unknown {
    if (typeof value === 'string') {
        const parsed = parseParamString(value);
        // Return ParamValue if expressions were found, otherwise keep original string
        return parsed !== null ? parsed : value;
    }
    if (Array.isArray(value)) {
        return value.map(walkValue);
    }
    if (typeof value === 'object' && value !== null) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            result[k] = walkValue(v);
        }
        return result;
    }
    // number, boolean, null → untouched
    return value;
}
