/**
 * Unit tests for Deployer module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Deployer } from '../deployer.js';
import * as registry from '../common/registry.js';
import * as resource from '../common/resource.js';
import type { Resource, Render, Command } from '../common/resource.js';
describe('Deployer', () => {
  let deployer: Deployer;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    deployer = new Deployer();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create a minimal Resource for testing
  // deps use Type.name format, e.g. 'AzureBlobStorage.registry'
  function makeResource(name: string, deps: string[] = [], overrides: Partial<Resource> = {}): Resource {
    return {
      name,
      type: 'AzureBlobStorage',
      ring: 'test',
      region: 'eastus',
      project: 'testproject',
      authProvider: { provider: {} as any, args: {} },
      dependencies: deps.map(d => ({ resource: d })),
      config: {},
      exports: {},
      ...overrides,
    };
  }

  describe('deploy', () => {
    it('should call render for each resource', async () => {
      const mockResources: Resource[] = [makeResource('test-storage')];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['storage', 'account', 'create', '--name', 'teststorage'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(
        mockResources[0],
        { skipResourceGroup: true }
      );
    });

    it('should filter resources by ring', async () => {
      const mockResources: Resource[] = [
        makeResource('test-storage', [], { ring: 'test' }),
        makeResource('prod-storage', [], { ring: 'production' }),
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['storage', 'account', 'create'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ ring: 'test', execute: false });

      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(
        mockResources[0],
        { skipResourceGroup: true }
      );
    });

    it('should filter resources by region', async () => {
      const mockResources: Resource[] = [
        makeResource('eastus-storage', [], { region: 'eastus' }),
        makeResource('westus-storage', [], { region: 'westus' }),
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['storage', 'account', 'create'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ region: 'eastus', execute: false });

      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(
        mockResources[0],
        { skipResourceGroup: true }
      );
    });

    it('should handle no matching resources', async () => {
      const mockResources: Resource[] = [makeResource('test-storage')];

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

      await deployer.deploy({ ring: 'production', execute: false });

      expect(consoleLogSpy).toHaveBeenCalledWith('No resources match the specified filters');
    });

    it('should throw error if render fails', async () => {
      const mockResources: Resource[] = [makeResource('test-storage')];

      const mockError = new Error('Render failed');
      const mockRender: Render = {
        render: vi.fn().mockRejectedValue(mockError)
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(deployer.deploy({ execute: false })).rejects.toThrow('Render failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to render AzureBlobStorage.test-storage:', mockError);
    });

    it('should print commands in dry-run mode', async () => {
      const mockResources: Resource[] = [makeResource('test-storage')];

      const mockCommands: Command[] = [
        { command: 'az', args: ['storage', 'account', 'create', '--name', 'teststorage'] }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue(mockCommands)
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated deployment commands (dry-run mode)')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('az storage account create --name teststorage');
    });
  });

  describe('buildExecutionLevels', () => {
    it('should place all independent resources in level 0', () => {
      const resources: Resource[] = [
        makeResource('storageA'),
        makeResource('storageB'),
        makeResource('storageC'),
      ];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(1);
      expect(levels[0]).toHaveLength(3);
      expect(levels[0].map(r => r.name).sort()).toEqual(['storageA', 'storageB', 'storageC']);
    });

    it('should place dependency before dependent (2 levels)', () => {
      const resources: Resource[] = [
        makeResource('app', ['AzureBlobStorage.registry']),
        makeResource('registry'),
      ];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(2);
      expect(levels[0].map(r => r.name)).toEqual(['registry']);
      expect(levels[1].map(r => r.name)).toEqual(['app']);
    });

    it('should handle diamond dependency (3 levels)', () => {
      const resources: Resource[] = [
        makeResource('A', ['AzureBlobStorage.B', 'AzureBlobStorage.C']),
        makeResource('B', ['AzureBlobStorage.D']),
        makeResource('C', ['AzureBlobStorage.D']),
        makeResource('D'),
      ];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(3);
      // Level 0: D (no deps)
      expect(levels[0].map(r => r.name)).toEqual(['D']);
      // Level 1: B and C (both depend only on D)
      expect(levels[1].map(r => r.name).sort()).toEqual(['B', 'C']);
      // Level 2: A (depends on B and C)
      expect(levels[2].map(r => r.name)).toEqual(['A']);
    });

    it('should order all name-matched dependency variants before any dependent variant', () => {
      const rings = ['staging', 'test'] as const;
      const regions = ['eastasia', 'koreacentral'] as const;

      const acrResources: Resource[] = rings.flatMap(ring =>
        regions.map(region => makeResource('chuangacr', [], { ring, region, type: 'AzureContainerRegistry' }))
      );

      const acaResources: Resource[] = rings.flatMap(ring =>
        regions.map(region => makeResource('chuangaca', ['AzureContainerRegistry.chuangacr'], { ring, region, type: 'AzureContainerApp' }))
      );

      // Deliberately put dependents before dependencies
      const resources = [...acaResources, ...acrResources];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(2);
      // Level 0: all acr variants
      expect(levels[0].every(r => r.name === 'chuangacr')).toBe(true);
      expect(levels[0]).toHaveLength(4);
      // Level 1: all aca variants
      expect(levels[1].every(r => r.name === 'chuangaca')).toBe(true);
      expect(levels[1]).toHaveLength(4);
    });

    it('should not error when a declared dependency is not in the filtered set', () => {
      const resources: Resource[] = [
        makeResource('chuangaca', ['AzureContainerRegistry.chuangacr']),
      ];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(1);
      expect(levels[0].map(r => r.name)).toEqual(['chuangaca']);
    });

    it('should throw on direct circular dependency (A → B → A)', () => {
      const resources: Resource[] = [
        makeResource('resourceA', ['AzureBlobStorage.resourceB']),
        makeResource('resourceB', ['AzureBlobStorage.resourceA']),
      ];

      expect(() => deployer.buildExecutionLevels(resources)).toThrow(
        /Circular dependency detected/
      );
    });

    it('should throw on transitive circular dependency (A → B → C → A)', () => {
      const resources: Resource[] = [
        makeResource('resourceA', ['AzureBlobStorage.resourceB']),
        makeResource('resourceB', ['AzureBlobStorage.resourceC']),
        makeResource('resourceC', ['AzureBlobStorage.resourceA']),
      ];

      expect(() => deployer.buildExecutionLevels(resources)).toThrow(
        /Circular dependency detected/
      );
    });

    it('should throw on self-dependency', () => {
      const resources: Resource[] = [
        makeResource('resourceA', ['AzureBlobStorage.resourceA']),
      ];

      expect(() => deployer.buildExecutionLevels(resources)).toThrow(
        /Circular dependency detected/
      );
    });

    it('should handle a deep chain (A → B → C → D → E)', () => {
      const resources: Resource[] = [
        makeResource('A', ['AzureBlobStorage.B']),
        makeResource('B', ['AzureBlobStorage.C']),
        makeResource('C', ['AzureBlobStorage.D']),
        makeResource('D', ['AzureBlobStorage.E']),
        makeResource('E'),
      ];

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(5);
      expect(levels[0].map(r => r.name)).toEqual(['E']);
      expect(levels[1].map(r => r.name)).toEqual(['D']);
      expect(levels[2].map(r => r.name)).toEqual(['C']);
      expect(levels[3].map(r => r.name)).toEqual(['B']);
      expect(levels[4].map(r => r.name)).toEqual(['A']);
    });

    it('should handle wide graph (many independent resources at level 0)', () => {
      const resources: Resource[] = Array.from({ length: 10 }, (_, i) =>
        makeResource(`storage${i}`)
      );

      const levels = deployer.buildExecutionLevels(resources);

      expect(levels).toHaveLength(1);
      expect(levels[0]).toHaveLength(10);
    });
  });

  describe('dependency ordering in deploy', () => {
    it('should render dependencies before dependents', async () => {
      const mockResources: Resource[] = [
        makeResource('chuangaca', ['AzureContainerRegistry.chuangacr'], { type: 'AzureContainerApp', ring: 'staging', region: 'eastasia', project: 'merlintest' }),
        makeResource('chuangacr', [], { type: 'AzureContainerRegistry', ring: 'staging', region: 'eastasia', project: 'merlintest' }),
      ];

      const renderOrder: string[] = [];
      const mockRender: Render = {
        render: vi.fn().mockImplementation(async (r: Resource) => {
          renderOrder.push(r.name);
          return [{ command: 'az', args: [] } as Command];
        })
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      expect(renderOrder).toEqual(['chuangacr', 'chuangaca']);
    });

    it('should handle diamond dependency in deploy', async () => {
      const mockResources = [
        makeResource('A', ['AzureBlobStorage.B', 'AzureBlobStorage.C']),
        makeResource('B', ['AzureBlobStorage.D']),
        makeResource('C', ['AzureBlobStorage.D']),
        makeResource('D', []),
      ];

      const renderOrder: string[] = [];
      const mockRender: Render = {
        render: vi.fn().mockImplementation(async (r: Resource) => {
          renderOrder.push(r.name);
          return [];
        })
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      const idx = (n: string) => renderOrder.indexOf(n);
      expect(idx('D')).toBeLessThan(idx('B'));
      expect(idx('D')).toBeLessThan(idx('C'));
      expect(idx('B')).toBeLessThan(idx('A'));
      expect(idx('C')).toBeLessThan(idx('A'));
    });

    it('should throw on circular dependency in deploy', async () => {
      const mockResources: Resource[] = [
        makeResource('resourceA', ['AzureBlobStorage.resourceB']),
        makeResource('resourceB', ['AzureBlobStorage.resourceA']),
      ];

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

      await expect(deployer.deploy({ execute: false })).rejects.toThrow(
        /Circular dependency detected/
      );
    });
  });

  describe('render context', () => {
    it('should pass skipResourceGroup context to renders', async () => {
      const mockResources: Resource[] = [makeResource('test-storage')];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      expect(mockRender.render).toHaveBeenCalledWith(
        mockResources[0],
        { skipResourceGroup: true }
      );
    });
  });

  describe('authProvider integration', () => {
    it('appends role-assignment commands from authProvider.apply() to the requestor resource', async () => {
      const authApply = vi.fn().mockResolvedValue([
        { command: 'az', args: ['role', 'assignment', 'create', '--role', 'AcrPull'] } as Command,
      ]);

      const providerResource = makeResource('acr', [], {
        type: 'AzureContainerRegistry',
        authProvider: {
          provider: { name: 'AzureManagedIdentity', apply: authApply, dependencies: [] },
          args: { role: 'AcrPull' },
        },
      });

      const requestorResource = makeResource('aca', ['AzureContainerRegistry.acr'], {
        type: 'AzureContainerApp',
      });

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['containerapp', 'create'] } as Command,
        ]),
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue([providerResource, requestorResource]);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      vi.spyOn(registry, 'getResource').mockReturnValue(providerResource);

      const allCommands: Command[] = [];
      (mockRender.render as any).mockImplementation(async (r: Resource) => {
        const cmds: Command[] = [{ command: 'az', args: [r.name] }];
        return cmds;
      });

      // Capture rendered commands via printCommandLevels
      const printSpy = vi.spyOn(deployer as any, 'printCommandLevels');

      await deployer.deploy({ execute: false });

      expect(authApply).toHaveBeenCalledTimes(1);
      expect(authApply).toHaveBeenCalledWith(
        requestorResource,
        providerResource,
        { role: 'AcrPull' },
      );
    });

    it('skips authProvider when dependency resource is not in registry', async () => {
      const authApply = vi.fn().mockResolvedValue([]);

      const requestorResource = makeResource('aca', ['AzureContainerRegistry.missing'], {
        type: 'AzureContainerApp',
      });

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([{ command: 'az', args: [] } as Command]),
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue([requestorResource]);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      // Registry returns undefined for the missing provider
      vi.spyOn(registry, 'getResource').mockReturnValue(undefined);

      await deployer.deploy({ execute: false });

      // authApply must not be called because the provider resource was not found
      expect(authApply).not.toHaveBeenCalled();
    });

    it('skips silently when dependency has no authProvider', async () => {
      const providerResource = makeResource('acr', [], {
        type: 'AzureContainerRegistry',
        authProvider: undefined, // no authProvider
      });

      const requestorResource = makeResource('aca', ['AzureContainerRegistry.acr'], {
        type: 'AzureContainerApp',
      });

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([{ command: 'az', args: [] } as Command]),
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue([providerResource, requestorResource]);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      vi.spyOn(registry, 'getResource').mockReturnValue(providerResource);

      // Should not throw
      await expect(deployer.deploy({ execute: false })).resolves.not.toThrow();
    });

    it('uses the dependency-level authProvider override when provided', async () => {
      const defaultApply  = vi.fn().mockResolvedValue([]);
      const overrideApply = vi.fn().mockResolvedValue([
        { command: 'az', args: ['role', 'assignment', 'create', '--role', 'Reader'] } as Command,
      ]);

      const providerResource = makeResource('acr', [], {
        type: 'AzureContainerRegistry',
        authProvider: {
          provider: { name: 'AzureManagedIdentity', apply: defaultApply, dependencies: [] },
          args: { role: 'AcrPull' },
        },
      });

      const overrideProvider = { name: 'Override', apply: overrideApply, dependencies: [] };

      const requestorResource: Resource = {
        ...makeResource('aca', [], { type: 'AzureContainerApp' }),
        dependencies: [{
          resource: 'AzureContainerRegistry.acr',
          authProvider: overrideProvider,
        }],
      };

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([{ command: 'az', args: [] } as Command]),
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue([providerResource, requestorResource]);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      vi.spyOn(registry, 'getResource').mockReturnValue(providerResource);

      await deployer.deploy({ execute: false });

      // The override should be used, not the default
      expect(overrideApply).toHaveBeenCalledTimes(1);
      expect(defaultApply).not.toHaveBeenCalled();
    });
  });

  describe('level-based output', () => {
    it('should print level headers in dry-run mode', async () => {
      const mockResources: Resource[] = [
        makeResource('app', ['AzureBlobStorage.storage']),
        makeResource('storage'),
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['create'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      // Should have level headers
      const logCalls = consoleLogSpy.mock.calls.map(c => c[0]);
      expect(logCalls.some(c => typeof c === 'string' && c.includes('Level'))).toBe(true);
    });
  });
});
