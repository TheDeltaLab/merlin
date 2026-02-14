/**
 * Resource registry for runtime resource lookup
 */

import { Resource } from './resource.js';

/**
 * Global resource registry
 */
const RESOURCE_REGISTRY = new Map<string, Resource>();

/**
 * Registers a resource for runtime lookup
 */
export function registerResource(resource: Resource): void {
    const key = makeResourceKey(resource.name, resource.ring, resource.region);

    if (RESOURCE_REGISTRY.has(key)) {
        throw new Error(`Duplicate resource: ${key}`);
    }

    RESOURCE_REGISTRY.set(key, resource);
}

/**
 * Gets a resource by name, ring, and optional region
 */
export function getResource(
    name: string,
    ring: string,
    region?: string
): Resource | undefined {
    const key = makeResourceKey(name, ring, region);
    return RESOURCE_REGISTRY.get(key);
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
 * Creates a unique key for a resource
 */
function makeResourceKey(name: string, ring: string, region?: string): string {
    return region ? `${name}:${ring}:${region}` : `${name}:${ring}`;
}
