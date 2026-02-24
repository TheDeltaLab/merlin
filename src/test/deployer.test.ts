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
  });
});
