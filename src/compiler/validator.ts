/**
 * Resource validator with schema and semantic validation
 */

import { ResourceYAMLSchema } from './schemas.js';
import { ParsedYAML, ValidationResult, CompilationError, ErrorSeverity } from './types.js';
import { parseParamString } from './interpolation.js';

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

    // Only ERROR-severity issues make a resource invalid; WARNINGs are informational
    const hasErrors = errors.some(e => e.severity === ErrorSeverity.ERROR);

    return {
        valid: !hasErrors,
        data: !hasErrors ? data : undefined,
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

    // 3. Validate parameter references in config
    const paramErrors = validateParamRefs(data, source);
    errors.push(...paramErrors);

    return errors;
}

/**
 * Validates ${ } parameter references in defaultConfig and specificConfig.
 *
 * Checks:
 *   - Syntax validity (malformed expressions → ERROR)
 *   - Dependency declarations (${ Type.name.export } must have Type.name in dependencies → ERROR)
 *   - Region usage (${ this.region } on a resource with no regions declared → WARNING)
 *
 * Does NOT validate export key names — that would require cross-file analysis.
 */
function validateParamRefs(data: any, source: string): CompilationError[] {
    const errors: CompilationError[] = [];
    const declaredDeps = new Set<string>(data.dependencies.map((d: any) => d.resource));
    const hasRegions = !!data.region;

    const configsToCheck: Array<{ config: Record<string, unknown>; path: string }> = [
        { config: data.defaultConfig, path: 'defaultConfig' },
        ...data.specificConfig.map((sc: any, i: number) => ({
            config: sc as Record<string, unknown>,
            path: `specificConfig[${i}]`
        }))
    ];

    for (const { config, path } of configsToCheck) {
        collectParamErrors(config, path, declaredDeps, hasRegions, source, errors);
    }

    return errors;
}

function collectParamErrors(
    obj: unknown,
    path: string,
    declaredDeps: Set<string>,
    hasRegions: boolean,
    source: string,
    errors: CompilationError[]
): void {
    if (typeof obj === 'string') {
        let parsed;
        try {
            parsed = parseParamString(obj);
        } catch (e) {
            errors.push({
                severity: ErrorSeverity.ERROR,
                message: (e as Error).message,
                source,
                path,
                hint: 'Parameter expressions must use format: ${ Type.name.exportKey }, ${ this.ring }, or ${ this.region }'
            });
            return;
        }
        if (!parsed) return;

        for (const seg of parsed.segments) {
            if (seg.type === 'dep') {
                const qualifiedRef = `${seg.resourceType}.${seg.resource}`;
                if (!declaredDeps.has(qualifiedRef)) {
                    errors.push({
                        severity: ErrorSeverity.ERROR,
                        message: `Parameter reference "\${ ${seg.resourceType}.${seg.resource}.${seg.export} }" in "${path}" references undeclared dependency "${qualifiedRef}"`,
                        source,
                        path,
                        hint: `Add "- resource: ${qualifiedRef}" to the dependencies array, or remove this parameter reference`
                    });
                }
            }
            if (seg.type === 'self' && seg.field === 'region' && !hasRegions) {
                errors.push({
                    severity: ErrorSeverity.WARNING,
                    message: `Parameter reference "\${ this.region }" in "${path}" is used but no regions are declared for this resource`,
                    source,
                    path,
                    hint: 'Region will be an empty string at runtime — add a "region:" field to the resource, or use "${ this.ring }" instead'
                });
            }
        }
        return;
    }
    if (Array.isArray(obj)) {
        obj.forEach((item, i) =>
            collectParamErrors(item, `${path}[${i}]`, declaredDeps, hasRegions, source, errors)
        );
        return;
    }
    if (typeof obj === 'object' && obj !== null) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            collectParamErrors(v, `${path}.${k}`, declaredDeps, hasRegions, source, errors);
        }
    }
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
