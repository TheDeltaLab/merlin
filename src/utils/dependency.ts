import type { Resource, Dependency } from '../types/index.js';

/**
 * Topological sort for dependency resolution
 * Returns resources in the order they should be processed
 */
export function topologicalSort(resources: Resource[]): Resource[] {
    const visited = new Set<string>();
    const sorted: Resource[] = [];
    const visiting = new Set<string>();

    function visit(resource: Resource): void {
        if (visited.has(resource.name)) {
            return;
        }

        if (visiting.has(resource.name)) {
            throw new Error(`Circular dependency detected: ${resource.name}`);
        }

        visiting.add(resource.name);

        // Visit dependencies first
        for (const dep of resource.dependencies) {
            const depResource = resources.find((r) => r.name === dep.resource);
            if (!depResource) {
                throw new Error(
                    `Dependency not found: ${dep.resource} (required by ${resource.name})`,
                );
            }
            visit(depResource);
        }

        visiting.delete(resource.name);
        visited.add(resource.name);
        sorted.push(resource);
    }

    for (const resource of resources) {
        visit(resource);
    }

    return sorted;
}

/**
 * Validates that all dependencies exist
 */
export function validateDependencies(resources: Resource[]): void {
    const resourceNames = new Set(resources.map((r) => r.name));

    for (const resource of resources) {
        for (const dep of resource.dependencies) {
            if (!resourceNames.has(dep.resource)) {
                throw new Error(
                    `Invalid dependency: ${resource.name} depends on ${dep.resource}, but ${dep.resource} does not exist`,
                );
            }
        }
    }
}
