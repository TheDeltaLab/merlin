/**
 * Factory functions for creating test data
 */

import { ParsedYAML, ResourceYAML, ExpandedResource, AuthProviderRef } from '../compiler/types.js';
import { Ring, Region } from '../common/resource.js';

/**
 * Create a minimal valid ResourceYAML
 */
export function createResourceYAML(overrides?: Partial<ResourceYAML>): ResourceYAML {
    const defaults: ResourceYAML = {
        name: 'test-resource',
        type: 'TestType',
        ring: 'test',
        authProvider: 'testProvider',
        dependencies: [],
        defaultConfig: {},
        specificConfig: [],
        exports: {}
    };

    return { ...defaults, ...overrides };
}

/**
 * Create a ParsedYAML object
 */
export function createParsedYAML(data: unknown, source = '/test/fixture.yml'): ParsedYAML {
    return { source, data };
}

/**
 * Create an ExpandedResource
 */
export function createExpandedResource(overrides?: Partial<ExpandedResource>): ExpandedResource {
    const defaults: ExpandedResource = {
        name: 'test-resource',
        ring: 'test',
        type: 'TestType',
        authProvider: { name: 'testProvider', args: {} },
        dependencies: [],
        config: {},
        exports: {}
    };

    return { ...defaults, ...overrides };
}

/**
 * Create a ResourceYAML with multiple rings
 */
export function createMultiRingResource(rings: Ring[]): ResourceYAML {
    return createResourceYAML({ ring: rings });
}

/**
 * Create a ResourceYAML with multiple regions
 */
export function createMultiRegionResource(rings: Ring[], regions: Region[]): ResourceYAML {
    return createResourceYAML({ ring: rings, region: regions });
}

/**
 * Create a ResourceYAML with specificConfig
 */
export function createResourceWithSpecificConfig(configs: any[]): ResourceYAML {
    return createResourceYAML({ specificConfig: configs });
}
