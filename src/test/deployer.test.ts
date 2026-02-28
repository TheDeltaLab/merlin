/**
 * Unit tests for Deployer module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Deployer } from '../deployer.js';
import * as registry from '../common/registry.js';
import * as resource from '../common/resource.js';
import type { Resource, Render, Command } from '../common/resource.js';
import { execa } from 'execa';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const mockExeca = vi.mocked(execa);

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

  describe('deploy', () => {
    it('should call render for each resource', async () => {
      // Mock resources
      const mockResources: Resource[] = [
        {
          name: 'test-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: {
            provider: {} as any,
            args: {}
          },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      // Mock render
      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          {
            command: 'az',
            args: ['storage', 'account', 'create', '--name', 'teststorage']
          } as Command
        ])
      };

      // Setup spies
      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      // Execute
      await deployer.deploy({ execute: false });

      // Verify
      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(mockResources[0]);
    });

    it('should filter resources by ring', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        },
        {
          name: 'prod-storage',
          type: 'AzureBlobStorage',
          ring: 'production',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['storage', 'account', 'create'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ ring: 'test', execute: false });

      // Should only render the test resource
      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(mockResources[0]);
    });

    it('should filter resources by region', async () => {
      const mockResources: Resource[] = [
        {
          name: 'eastus-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        },
        {
          name: 'westus-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'westus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue([
          { command: 'az', args: ['storage', 'account', 'create'] } as Command
        ])
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ region: 'eastus', execute: false });

      // Should only render the eastus resource
      expect(mockRender.render).toHaveBeenCalledTimes(1);
      expect(mockRender.render).toHaveBeenCalledWith(mockResources[0]);
    });

    it('should handle no matching resources', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

      await deployer.deploy({ ring: 'production', execute: false });

      // Should log message about no matching resources
      expect(consoleLogSpy).toHaveBeenCalledWith('No resources match the specified filters');
    });

    describe('dependency ordering', () => {
      it('should render dependencies before dependents', async () => {
        // chuangaca is inserted first but depends on chuangacr — should render after
        const mockResources: Resource[] = [
          {
            name: 'chuangaca',
            type: 'AzureContainerApp',
            ring: 'staging',
            region: 'eastasia',
            project: 'merlintest',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'chuangacr', isHardDependency: true }],
            config: {},
            exports: {}
          },
          {
            name: 'chuangacr',
            type: 'AzureContainerRegistry',
            ring: 'staging',
            region: 'eastasia',
            project: 'merlintest',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [],
            config: {},
            exports: {}
          }
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

      it('should order all name-matched dependency variants before any dependent variant', async () => {
        // 4 chuangaca (2 rings × 2 regions), each depends on 'chuangacr' by name
        // 4 chuangacr variants with no deps
        // Expected: all chuangacr variants before any chuangaca variant
        const rings = ['staging', 'test'] as const;
        const regions = ['eastasia', 'koreacentral'] as const;

        const acrResources: Resource[] = rings.flatMap(ring =>
          regions.map(region => ({
            name: 'chuangacr', type: 'AzureContainerRegistry',
            ring, region, project: 'merlintest',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [], config: {}, exports: {}
          }))
        );

        const acaResources: Resource[] = rings.flatMap(ring =>
          regions.map(region => ({
            name: 'chuangaca', type: 'AzureContainerApp',
            ring, region, project: 'merlintest',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'chuangacr', isHardDependency: true }],
            config: {}, exports: {}
          }))
        );

        // Deliberately put dependents before dependencies
        const mockResources = [...acaResources, ...acrResources];

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

        // All 4 acr variants must appear before any aca variant
        const firstAcaIndex = renderOrder.findIndex(n => n === 'chuangaca');
        const lastAcrIndex = renderOrder.lastIndexOf('chuangacr');
        expect(lastAcrIndex).toBeLessThan(firstAcaIndex);
        expect(renderOrder.filter(n => n === 'chuangacr')).toHaveLength(4);
        expect(renderOrder.filter(n => n === 'chuangaca')).toHaveLength(4);
      });

      it('should not error when a declared dependency is not in the filtered set', async () => {
        // chuangaca depends on chuangacr, but chuangacr is absent from the set
        const mockResources: Resource[] = [
          {
            name: 'chuangaca',
            type: 'AzureContainerApp',
            ring: 'staging',
            region: 'eastasia',
            project: 'merlintest',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'chuangacr', isHardDependency: true }],
            config: {},
            exports: {}
          }
        ];

        const mockRender: Render = {
          render: vi.fn().mockResolvedValue([])
        };

        vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
        vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

        await expect(deployer.deploy({ execute: false })).resolves.toBeUndefined();
        expect(mockRender.render).toHaveBeenCalledTimes(1);
      });

      it('should throw on direct circular dependency (A → B → A)', async () => {
        const mockResources: Resource[] = [
          {
            name: 'resourceA',
            type: 'AzureBlobStorage',
            ring: 'test',
            region: 'eastus',
            project: 'test',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'resourceB' }],
            config: {},
            exports: {}
          },
          {
            name: 'resourceB',
            type: 'AzureBlobStorage',
            ring: 'test',
            region: 'eastus',
            project: 'test',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'resourceA' }],
            config: {},
            exports: {}
          }
        ];

        vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

        await expect(deployer.deploy({ execute: false })).rejects.toThrow(
          /Circular dependency detected/
        );
      });

      it('should throw on transitive circular dependency (A → B → C → A)', async () => {
        const make = (name: string, depName: string): Resource => ({
          name,
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'test',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [{ resource: depName }],
          config: {},
          exports: {}
        });

        const mockResources = [
          make('resourceA', 'resourceB'),
          make('resourceB', 'resourceC'),
          make('resourceC', 'resourceA'),
        ];

        vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

        await expect(deployer.deploy({ execute: false })).rejects.toThrow(
          /Circular dependency detected/
        );
      });

      it('should throw on self-dependency', async () => {
        const mockResources: Resource[] = [
          {
            name: 'resourceA',
            type: 'AzureBlobStorage',
            ring: 'test',
            region: 'eastus',
            project: 'test',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [{ resource: 'resourceA' }],
            config: {},
            exports: {}
          }
        ];

        vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);

        await expect(deployer.deploy({ execute: false })).rejects.toThrow(
          /Circular dependency detected/
        );
      });

      it('should handle diamond dependency (D before B and C, both before A)', async () => {
        const make = (name: string, deps: string[]): Resource => ({
          name,
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'test',
          authProvider: { provider: {} as any, args: {} },
          dependencies: deps.map(d => ({ resource: d })),
          config: {},
          exports: {}
        });

        // Insertion order: A (depends on B, C), B (depends on D), C (depends on D), D (no deps)
        const mockResources = [
          make('A', ['B', 'C']),
          make('B', ['D']),
          make('C', ['D']),
          make('D', []),
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
    });

    it('should throw error if render fails', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockError = new Error('Render failed');
      const mockRender: Render = {
        render: vi.fn().mockRejectedValue(mockError)
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(deployer.deploy({ execute: false })).rejects.toThrow('Render failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to render test-storage:', mockError);
    });

    it('should print commands in dry-run mode', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-storage',
          type: 'AzureBlobStorage',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockCommands: Command[] = [
        {
          command: 'az',
          args: ['storage', 'account', 'create', '--name', 'teststorage']
        }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue(mockCommands)
      };

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: false });

      // Should print commands
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated deployment commands (dry-run mode)')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('az storage account create --name teststorage');
    });

    it('should skip docker push when ACR image tag already exists', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-acr',
          type: 'AzureContainerRegistry',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockCommands: Command[] = [
        {
          command: 'docker',
          args: ['push', 'myacr.azurecr.io/nginx:latest'],
          skipIfAcrImageExists: {
            registryName: 'myacr',
            repository: 'nginx',
            tag: 'latest'
          }
        }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue(mockCommands)
      };

      mockExeca.mockResolvedValueOnce({
          stdout: 'latest',
          stderr: '',
          exitCode: 0
        } as Awaited<ReturnType<typeof execa>>);

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: true });

      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(mockExeca).toHaveBeenCalledWith(
        'az',
        ['acr', 'repository', 'show-tags', '--name', 'myacr', '--repository', 'nginx', '-o', 'tsv'],
        { reject: false }
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('(skipped: image already exists in ACR)')
      );
    });

    it('should execute docker push when ACR image tag does not exist', async () => {
      const mockResources: Resource[] = [
        {
          name: 'test-acr',
          type: 'AzureContainerRegistry',
          ring: 'test',
          region: 'eastus',
          project: 'testproject',
          authProvider: { provider: {} as any, args: {} },
          dependencies: [],
          config: {},
          exports: {}
        }
      ];

      const mockCommands: Command[] = [
        {
          command: 'docker',
          args: ['push', 'myacr.azurecr.io/nginx:latest'],
          skipIfAcrImageExists: {
            registryName: 'myacr',
            repository: 'nginx',
            tag: 'latest'
          }
        }
      ];

      const mockRender: Render = {
        render: vi.fn().mockResolvedValue(mockCommands)
      };

      mockExeca.mockResolvedValueOnce({
          stdout: 'v1.0',
          stderr: '',
          exitCode: 0
        } as Awaited<ReturnType<typeof execa>>)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0
        } as Awaited<ReturnType<typeof execa>>);

      vi.spyOn(registry, 'getAllResources').mockReturnValue(mockResources);
      vi.spyOn(resource, 'getRender').mockReturnValue(mockRender);

      await deployer.deploy({ execute: true });

      expect(mockExeca).toHaveBeenNthCalledWith(
        1,
        'az',
        ['acr', 'repository', 'show-tags', '--name', 'myacr', '--repository', 'nginx', '-o', 'tsv'],
        { reject: false }
      );
      expect(mockExeca).toHaveBeenNthCalledWith(
        2,
        'docker',
        ['push', 'myacr.azurecr.io/nginx:latest']
      );
    });
  });
});
