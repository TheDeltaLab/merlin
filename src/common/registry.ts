/**
 * Resource registry for runtime resource lookup
 */

import { Resource, getRender } from './resource.js';

/**
 * Global resource registry
 */
const RESOURCE_REGISTRY = new Map<string, Resource>();

/**
 * Registers a resource for runtime lookup.
 * Reads isGlobalResource from the corresponding Render implementation and
 * stamps it onto the resource before storing, so lookup logic can rely on it.
 */
export function registerResource(resource: Resource): void {
    // Stamp isGlobalResource from the Render implementation onto the resource
    try {
        const render = getRender(resource.type);
        if (render.isGlobalResource) {
            resource = { ...resource, isGlobalResource: true };
        }
    } catch {
        // Render not found — leave isGlobalResource as-is (undefined / false)
    }

    const key = makeResourceKey(resource.type, resource.name, resource.ring, resource.region);

    if (RESOURCE_REGISTRY.has(key)) {
        throw new Error(`Duplicate resource: ${key}`);
    }

    RESOURCE_REGISTRY.set(key, resource);
}

/**
 * Gets a resource by type, name, ring, and optional region.
 * If the resource is registered as a global resource (isGlobalResource = true),
 * the region is ignored and the lookup falls back to the ring-only key.
 *
 * When the caller has no region (e.g. a global SP referencing a regional AKS),
 * falls back to any resource matching type:name:ring regardless of region.
 */
export function getResource(
    type: string,
    name: string,
    ring: string,
    region?: string
): Resource | undefined {
    // First try exact match (with region)
    const exactKey = makeResourceKey(type, name, ring, region);
    const exact = RESOURCE_REGISTRY.get(exactKey);
    if (exact) return exact;

    // If region was provided, also try the global (region-less) key
    if (region) {
        const globalKey = makeResourceKey(type, name, ring, undefined);
        const global = RESOURCE_REGISTRY.get(globalKey);
        if (global?.isGlobalResource) return global;
    }

    // If no region was provided (caller is a global resource), try to find
    // any regional resource matching type:name:ring:* (pick the first match).
    // This allows global resources (e.g. SP) to reference regional resources (e.g. AKS).
    if (!region) {
        const prefix = `${type}:${name}:${ring}:`;
        for (const [key, res] of RESOURCE_REGISTRY) {
            if (key.startsWith(prefix)) return res;
        }
    }

    return undefined;
}

/**
 * Gets all registered resources
 */
export function getAllResources(): Resource[] {
    return Array.from(RESOURCE_REGISTRY.values());
}

/**
 * Clears the registry (useful for testing)
 */
export function clearRegistry(): void {
    RESOURCE_REGISTRY.clear();
}

/**
 * Creates a unique key for a resource.
 * Format: type:name:ring[:region]
 */
export function makeResourceKey(type: string, name: string, ring: string, region?: string): string {
    return region ? `${type}:${name}:${ring}:${region}` : `${type}:${name}:${ring}`;
}
