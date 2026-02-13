import { describe, it, expect } from 'vitest';
import { topologicalSort, validateDependencies } from './dependency.js';
import type { Resource } from '../types/index.js';
import { MicrosoftIdentityProviderAuth } from '../actions/microsoft-identity-auth.js';

describe('topologicalSort', () => {
    it('should sort resources in dependency order', () => {
        const resources: Resource[] = [
            {
                name: 'app',
                type: 'AzureContainerApp',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [{ resource: 'db' }],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
            {
                name: 'db',
                type: 'StorageAccount',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
        ];

        const sorted = topologicalSort(resources);
        expect(sorted.map((r) => r.name)).toEqual(['db', 'app']);
    });

    it('should throw error on circular dependency', () => {
        const resources: Resource[] = [
            {
                name: 'app',
                type: 'AzureContainerApp',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [{ resource: 'db' }],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
            {
                name: 'db',
                type: 'StorageAccount',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [{ resource: 'app' }],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
        ];

        expect(() => topologicalSort(resources)).toThrow('Circular dependency detected');
    });
});

describe('validateDependencies', () => {
    it('should pass for valid dependencies', () => {
        const resources: Resource[] = [
            {
                name: 'app',
                type: 'AzureContainerApp',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [{ resource: 'db' }],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
            {
                name: 'db',
                type: 'StorageAccount',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
        ];

        expect(() => validateDependencies(resources)).not.toThrow();
    });

    it('should throw error for invalid dependency', () => {
        const resources: Resource[] = [
            {
                name: 'app',
                type: 'AzureContainerApp',
                ring: 'test',
                authProvider: new MicrosoftIdentityProviderAuth(),
                dependencies: [{ resource: 'nonexistent' }],
                defaultConfig: {},
                specificConfigs: [],
                exports: {},
            },
        ];

        expect(() => validateDependencies(resources)).toThrow('Invalid dependency');
    });
});
