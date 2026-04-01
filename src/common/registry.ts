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
 *
 * Lookup strategy (tries in order until a match is found):
 * 1. Exact match: type:name:ring:region
 * 2. Global resource (no region): type:name:ring (if resource.isGlobalResource)
 * 3. Ring-less resource: type:name (for resources with no ring, e.g. shared ACR)
 * 4. If caller has no region, scan for any type:name:ring:* match
 * 5. If caller has no ring, scan for any type:name:*[:*] match
 */
export function getResource(
    type: string,
    name: string,
    ring?: string,
    region?: string
): Resource | undefined {
    // 1. Exact match (with ring and region)
    const exactKey = makeResourceKey(type, name, ring, region);
    const exact = RESOURCE_REGISTRY.get(exactKey);
    if (exact) return exact;

    // 2. If region was provided, try global (region-less) key with same ring
    if (region && ring) {
        const globalKey = makeResourceKey(type, name, ring, undefined);
        const global = RESOURCE_REGISTRY.get(globalKey);
        if (global?.isGlobalResource) return global;
    }

    // 3. Try ring-less key (for resources that have no ring at all)
    if (ring) {
        const ringlessKey = makeResourceKey(type, name, undefined, undefined);
        const ringless = RESOURCE_REGISTRY.get(ringlessKey);
        if (ringless) return ringless;
    }

    // 4. If no region was provided (caller is a global resource), try to find
    // any regional resource matching type:name:ring:* (pick the first match).
    if (ring && !region) {
        const prefix = `${type}:${name}:${ring}:`;
        for (const [key, res] of RESOURCE_REGISTRY) {
            if (key.startsWith(prefix)) return res;
        }
    }

    // 5. If no ring was provided, scan for any matching type:name:*
    if (!ring) {
        const prefix = `${type}:${name}:`;
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
 * Format: type:name[:ring[:region]]
 */
export function makeResourceKey(type: string, name: string, ring?: string, region?: string): string {
    if (ring && region) return `${type}:${name}:${ring}:${region}`;
    if (ring) return `${type}:${name}:${ring}`;
    return `${type}:${name}`;
}
