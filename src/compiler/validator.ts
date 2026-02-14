/**
 * Resource validator with schema and semantic validation
 */

import { ResourceYAMLSchema } from './schemas.js';
import { ParsedYAML, ValidationResult, CompilationError, ErrorSeverity } from './types.js';

/**
 * Validates a parsed YAML resource against schema and semantic rules
 */
export function validate(parsed: ParsedYAML): ValidationResult {
    const errors: CompilationError[] = [];

    // 1. Schema validation with Zod
    const schemaResult = ResourceYAMLSchema.safeParse(parsed.data);

    if (!schemaResult.success) {
        // Convert Zod errors to CompilationErrors
        for (const zodError of schemaResult.error.errors) {
            errors.push({
                severity: ErrorSeverity.ERROR,
                message: zodError.message,
                source: parsed.source,
                path: zodError.path.join('.'),
                hint: getHintForZodError(zodError)
            });
        }

        return {
            valid: false,
            errors
        };
    }

    const data = schemaResult.data;

    // 2. Semantic validation
    const semanticErrors = performSemanticValidation(data, parsed.source);
    errors.push(...semanticErrors);

    return {
        valid: errors.length === 0,
        data: errors.length === 0 ? data : undefined,
        errors
    };
}

/**
 * Performs semantic validation (cross-field constraints, references, etc.)
 */
function performSemanticValidation(data: any, source: string): CompilationError[] {
    const errors: CompilationError[] = [];

    // Note: We'll check authProvider registration at runtime rather than compile-time
    // This allows for flexible plugin loading and avoids circular dependencies

    // Validate specificConfig rings/regions match declared rings/regions
    const declaredRings = Array.isArray(data.ring) ? data.ring : [data.ring];
    const declaredRegions = data.region
        ? (Array.isArray(data.region) ? data.region : [data.region])
        : [];

    for (let i = 0; i < data.specificConfig.length; i++) {
        const spec = data.specificConfig[i];

        if (spec.ring && !declaredRings.includes(spec.ring)) {
            errors.push({
                severity: ErrorSeverity.ERROR,
                message: `specificConfig[${i}] references ring '${spec.ring}' which is not in the declared rings`,
                source,
                path: `specificConfig[${i}].ring`,
                hint: `Declared rings are: ${declaredRings.join(', ')}`
            });
        }

        if (spec.region && declaredRegions.length > 0 && !declaredRegions.includes(spec.region)) {
            errors.push({
                severity: ErrorSeverity.ERROR,
                message: `specificConfig[${i}] references region '${spec.region}' which is not in the declared regions`,
                source,
                path: `specificConfig[${i}].region`,
                hint: `Declared regions are: ${declaredRegions.join(', ')}`
            });
        }
    }

    return errors;
}

/**
 * Provides helpful hints for common Zod validation errors
 */
function getHintForZodError(error: any): string | undefined {
    const code = error.code;
    const path = error.path.join('.');

    if (code === 'invalid_type' && path === 'ring') {
        return 'Valid rings are: test, staging, production';
    }

    if (code === 'invalid_enum_value' && path === 'ring') {
        return 'Valid rings are: test, staging, production';
    }

    if (code === 'invalid_type' && path === 'region') {
        return 'Valid regions are: eastus, westus, eastasia, koreacentral, koreasouth';
    }

    if (code === 'invalid_enum_value' && path === 'region') {
        return 'Valid regions are: eastus, westus, eastasia, koreacentral, koreasouth';
    }

    if (path.includes('authProvider')) {
        return 'authProvider should be either a string (provider name) or an object with a "name" field';
    }

    return undefined;
}
