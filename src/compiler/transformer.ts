/**
 * Resource transformer - expands ring/region combinations and merges configurations
 */

import { ResourceYAML, ExpandedResource, AuthProviderRef, AuthProviderYAML, ExportRef } from './types.js';
import { Ring, Region } from '../common/resource.js';
import { parseConfigParams } from './interpolation.js';

/**
 * Expands a resource YAML into multiple resources (one per ring+region combination)
 * and merges configuration overrides
 */
export function expand(resource: ResourceYAML): ExpandedResource[] {
    // Normalize to arrays
    const rings: Ring[] = Array.isArray(resource.ring) ? resource.ring : [resource.ring];
    // 'none' is an explicit opt-out from region expansion (for global resources)
    const regions: (Region | undefined)[] = (!resource.region || resource.region === 'none')
        ? [undefined]
        : (Array.isArray(resource.region) ? resource.region : [resource.region]);

    // Cartesian product: rings × regions
    const combinations = rings.flatMap(ring =>
        regions.map(region => ({ ring, region }))
    );

    // Generate one ExpandedResource per combination
    return combinations.map(({ ring, region }) => {
        // Find matching specificConfig entries
        const matchingConfigs = resource.specificConfig.filter(spec => {
            const ringMatch = !spec.ring || spec.ring === ring;
            const regionMatch = !spec.region || spec.region === region;
            return ringMatch && regionMatch;
        });

        // Merge: defaultConfig + matchingConfigs (in order)
        // specificConfig values override defaultConfig for duplicate keys
        // Extract ring/region from specificConfig before merging
        const configsToMerge = matchingConfigs.map(({ ring, region, ...config }) => config);
        const mergedConfig = deepMerge(resource.defaultConfig, ...configsToMerge);

        // Parse ${ } parameter expressions in the merged config.
        // Must happen AFTER deepMerge so that raw strings are merged first,
        // avoiding any accidental merging of two ParamValue objects.
        const paramConfig = parseConfigParams(mergedConfig);

        return {
            name: resource.name,
            ring,
            region,
            type: resource.type,
            project: resource.project,
            parent: resource.parent,
            authProvider: toAuthProviderRef(resource.authProvider),
            dependencies: resource.dependencies,
            config: paramConfig,
            exports: toExportRefs(resource.exports)
        };
    });
}

/**
 * Converts authProvider from YAML format to AuthProviderRef
 */
function toAuthProviderRef(authProvider: string | AuthProviderYAML | undefined): AuthProviderRef | undefined {
    if (authProvider === undefined || authProvider === null) {
        return undefined;
    }

    if (typeof authProvider === 'string') {
        return {
            name: authProvider,
            args: {}
        };
    }

    const { name, ...args } = authProvider;
    return {
        name,
        args
    };
}

/**
 * Converts exports from YAML format to ExportRef format
 */
function toExportRefs(exports: Record<string, unknown>): Record<string, ExportRef> {
    const result: Record<string, ExportRef> = {};

    for (const [key, value] of Object.entries(exports)) {
        if (typeof value === 'string') {
            result[key] = {
                name: value,
                args: {}
            };
        } else if (typeof value === 'object' && value !== null) {
            const { name, ...args } = value as { name: string; [key: string]: string };
            result[key] = {
                name,
                args
            };
        }
    }

    return result;
}

/**
 * Deep merges multiple objects, with later objects overriding earlier ones.
 * For duplicate keys, the value from the later object (specificConfig) takes precedence.
 */
function deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const obj of objects) {
        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined) {
                continue;
            }

            const existingValue = result[key];

            // If both values are plain objects (not arrays, not null), merge them recursively
            if (
                existingValue &&
                typeof existingValue === 'object' &&
                !Array.isArray(existingValue) &&
                existingValue !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                value !== null
            ) {
                // Both are objects, merge recursively
                // Later object (specificConfig) takes precedence for duplicate keys
                result[key] = deepMerge(
                    existingValue as Record<string, unknown>,
                    value as Record<string, unknown>
                );
            } else {
                // For all other cases (primitives, arrays, null, or type mismatch),
                // the later value (from specificConfig) completely overrides the earlier value
                result[key] = value;
            }
        }
    }

    return result;
}
