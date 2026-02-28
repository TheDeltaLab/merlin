/**
 * Deployment orchestration module
 * Handles resource deployment using render functions from the registry.
 *
 * Uses a DAG-based execution model:
 *   1. Resources are grouped into execution levels (layers) via topological sort
 *   2. Resources within the same level have no dependency on each other and can run in parallel
 *   3. Resource groups are deduplicated and deployed as level 0
 */

import { Resource, Command, RenderContext } from './common/resource.js';
import { getAllResources } from './common/registry.js';
import { getRender } from './common/resource.js';
import { AzureResourceGroupRender } from './azure/resourceGroup.js';
import { execa } from 'execa';
import * as fs from 'fs/promises';

/** Default concurrency limit for parallel resource deployment */
const DEFAULT_CONCURRENCY = 4;

export interface DeployOptions {
  ring?: string;
  region?: string;
  execute: boolean;
  outputFile?: string;
  /**
   * Maximum number of resources to deploy in parallel within the same execution level.
   * Defaults to 4.
   */
  concurrency?: number;
}

/** A single resource with its rendered deployment commands */
interface ResourceCommands {
  resource: Resource;
  commands: Command[];
}

/**
 * An execution level: a group of resources that can be deployed in parallel.
 * Level 0 is reserved for resource groups when RG deduplication is active.
 */
type ExecutionLevel = ResourceCommands[];

export class Deployer {
  /**
   * Main deployment orchestration function.
   *
   * Flow:
   *   1. Filter resources by ring/region
   *   2. Build execution levels (DAG-based topological layers)
   *   3. Deduplicate and render resource groups as level 0
   *   4. Render resource commands for each level (with skipResourceGroup context)
   *   5. Execute (parallel within level) or print/write commands
   */
  async deploy(options: DeployOptions): Promise<void> {
    // 1. Get all resources and filter by ring/region
    const filtered = this.filterResources(getAllResources(), options);

    if (filtered.length === 0) {
      console.log('No resources match the specified filters');
      return;
    }

    // 2. Build execution levels from dependency DAG
    const resourceLevels = this.buildExecutionLevels(filtered);

    // 3. Deduplicate resource groups and build RG level (level 0)
    const flatResources = resourceLevels.flat();
    const rgLevel = await this.renderResourceGroupLevel(flatResources);

    // 4. Render commands for each resource level (skip RG creation in renders)
    const renderContext: RenderContext = { skipResourceGroup: true };
    const commandLevels: ExecutionLevel[] = [];

    // Add RG level as level 0 (may be empty if all RGs already exist)
    if (rgLevel.length > 0) {
      commandLevels.push(rgLevel);
    }

    for (let i = 0; i < resourceLevels.length; i++) {
      const level = resourceLevels[i];
      const levelCommands: ResourceCommands[] = [];

      for (const resource of level) {
        console.log(`Rendering ${resource.type}.${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})...`);

        try {
          const render = getRender(resource.type);
          const commands = await render.render(resource, renderContext);
          levelCommands.push({ resource, commands });
        } catch (error) {
          console.error(`Failed to render ${resource.type}.${resource.name}:`, error);
          throw error;
        }
      }

      // Only add non-empty levels
      if (levelCommands.length > 0) {
        commandLevels.push(levelCommands);
      }
    }

    // 5. Output or execute commands based on options
    if (options.outputFile) {
      await this.writeCommandLevelsToFile(commandLevels, options.outputFile);
    }

    if (options.execute) {
      const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
      await this.executeLevels(commandLevels, concurrency);
    } else if (!options.outputFile) {
      // Only print if not already writing to file
      this.printCommandLevels(commandLevels);
    }
  }

  /**
   * Builds execution levels from the dependency DAG using Kahn's BFS variant.
   * Each level contains resources that have no dependency on each other.
   *
   * Dependencies are matched by "Type.name" — all resources with a given type+name
   * are treated as predecessors of any resource that declares a dependency on that qualified reference.
   *
   * @throws Error on circular dependencies
   */
  buildExecutionLevels(resources: Resource[]): Resource[][] {
    // Index resources by Type.name for fast lookup (matches dependency reference format)
    const byTypeName = new Map<string, Resource[]>();
    for (const r of resources) {
      const key = `${r.type}.${r.name}`;
      const list = byTypeName.get(key) ?? [];
      list.push(r);
      byTypeName.set(key, list);
    }

    const resourceKey = (r: Resource) =>
      r.region ? `${r.type}:${r.name}:${r.ring}:${r.region}` : `${r.type}:${r.name}:${r.ring}`;

    const keyToResource = new Map<string, Resource>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, Set<string>>(); // predecessor → successors

    for (const r of resources) {
      const key = resourceKey(r);
      keyToResource.set(key, r);
      inDegree.set(key, 0);
      dependents.set(key, new Set());
    }

    for (const r of resources) {
      const rKey = resourceKey(r);
      for (const dep of r.dependencies) {
        for (const depResource of (byTypeName.get(dep.resource) ?? [])) {
          const depKey = resourceKey(depResource);
          inDegree.set(rKey, inDegree.get(rKey)! + 1);
          dependents.get(depKey)!.add(rKey);
        }
      }
    }

    // Kahn's BFS — collect each round as a level
    const levels: Resource[][] = [];
    let processedCount = 0;

    // Find initial nodes with in-degree 0
    let currentLevel: string[] = [];
    for (const [key, degree] of inDegree) {
      if (degree === 0) currentLevel.push(key);
    }

    while (currentLevel.length > 0) {
      // Collect resources for this level
      const levelResources: Resource[] = [];
      const nextLevel: string[] = [];

      for (const key of currentLevel) {
        levelResources.push(keyToResource.get(key)!);
        processedCount++;

        // Update successors
        for (const sKey of dependents.get(key)!) {
          const newDeg = inDegree.get(sKey)! - 1;
          inDegree.set(sKey, newDeg);
          if (newDeg === 0) nextLevel.push(sKey);
        }
      }

      levels.push(levelResources);
      currentLevel = nextLevel;
    }

    if (processedCount !== resources.length) {
      const cycleKeys = [...inDegree.entries()]
        .filter(([, d]) => d > 0)
        .map(([k]) => k);
      throw new Error(
        `Circular dependency detected among resources: ${cycleKeys.join(', ')}`
      );
    }

    return levels;
  }

  /**
   * Collect all unique resource groups needed by the resources,
   * render their creation commands (deduplicated), and return as a single level.
   */
  private async renderResourceGroupLevel(resources: Resource[]): Promise<ResourceCommands[]> {
    const rgRender = new AzureResourceGroupRender();
    const seen = new Map<string, ResourceCommands>(); // rgName → commands

    for (const r of resources) {
      // Skip resources that don't have a region (global resources handle RG differently)
      // DNS zones use their own ensureResourceGroupCommandsForDnsZone which is also context-aware
      if (!r.region) continue;

      const rgName = rgRender.getResourceGroupName(r);
      if (!seen.has(rgName)) {
        const commands = await rgRender.render(r);
        if (commands.length > 0) {
          // Create a synthetic resource entry for the RG
          const rgResource: Resource = {
            name: `rg:${rgName}`,
            type: 'AzureResourceGroup',
            ring: r.ring,
            region: r.region,
            project: r.project,
            dependencies: [],
            config: {},
            exports: {},
          };
          seen.set(rgName, { resource: rgResource, commands });
        }
      }
    }

    return [...seen.values()];
  }

  /**
   * Filter resources by ring and region
   */
  private filterResources(resources: Resource[], options: DeployOptions): Resource[] {
    return resources.filter(resource => {
      if (options.ring && resource.ring !== options.ring) {
        return false;
      }
      if (options.region && resource.region !== options.region) {
        return false;
      }
      return true;
    });
  }

  /**
   * Formats a single command as a shell line.
   * - If the command has envCapture, emits: VARNAME=$(command args)
   * - Otherwise emits: command args
   */
  private commandToShellLine(command: Command): string {
    const cmdStr = `${command.command} ${command.args.join(' ')}`;
    if (command.envCapture) {
      return `${command.envCapture}=$(${cmdStr})`;
    }
    return cmdStr;
  }

  /**
   * Execute all levels sequentially, with resources within each level
   * running in parallel (up to the concurrency limit).
   *
   * Captured variables (envCapture) are shared across all levels and resources.
   * Within the same level, different resources write to different variable names
   * (since variable names include the resource name), so there are no conflicts.
   */
  private async executeLevels(
    levels: ExecutionLevel[],
    concurrency: number
  ): Promise<void> {
    console.log('\nExecuting deployment commands...\n');

    // Shared in-memory map for captured variable values across all resources
    const captureVars = new Map<string, string>();

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      console.log(`── Level ${i} (${level.length} resource${level.length > 1 ? 's' : ''}) ──`);

      // Execute resources within this level in parallel with concurrency limit
      const tasks = level.map(({ resource, commands }) =>
        () => this.executeResourceCommands(resource, commands, captureVars)
      );

      await this.executeWithConcurrency(tasks, concurrency);
    }

    console.log('Deployment completed successfully!');
  }

  /**
   * Execute all commands for a single resource sequentially.
   */
  private async executeResourceCommands(
    resource: Resource,
    commands: Command[],
    captureVars: Map<string, string>
  ): Promise<void> {
    console.log(`Deploying ${resource.type}.${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})...`);

    for (const command of commands) {
      const commandStr = this.commandToShellLine(command);
      console.log(`> ${commandStr}`);

      try {
        if (command.envCapture) {
          // Capture command: run it and store stdout in map
          const expandedArgs = command.args.map(arg => expandVars(arg, captureVars));
          const { stdout } = await execa(command.command, expandedArgs);
          captureVars.set(command.envCapture, stdout.trim());
        } else {
          // Regular command: expand any $VARNAME references in args first
          const expandedArgs = command.args.map(arg => expandVars(arg, captureVars));
          const { stdout, stderr } = await execa(command.command, expandedArgs);

          if (stdout) {
            console.log(stdout);
          }
          if (stderr) {
            console.error(stderr);
          }
        }
      } catch (error) {
        console.error(`✗ Failed to execute: ${commandStr}`);
        console.error(error);
        throw error;
      }
    }

    console.log('');
  }

  /**
   * Execute an array of async tasks with a concurrency limit.
   * Tasks are started up to `concurrency` at a time; as each finishes,
   * the next one is started.
   */
  private async executeWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number
  ): Promise<T[]> {
    if (tasks.length === 0) return [];

    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;
    let firstError: unknown = undefined;

    async function runNext(): Promise<void> {
      while (nextIndex < tasks.length && !firstError) {
        const currentIndex = nextIndex++;
        try {
          results[currentIndex] = await tasks[currentIndex]();
        } catch (error) {
          firstError = error;
          throw error;
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => runNext()
    );

    // Wait for all workers; if any threw, propagate the first error
    const settled = await Promise.allSettled(workers);
    const rejected = settled.find(r => r.status === 'rejected');
    if (rejected) {
      throw (rejected as PromiseRejectedResult).reason;
    }

    return results;
  }

  /**
   * Print commands grouped by level without executing.
   * Capture commands are shown as VARNAME=$(command args).
   */
  private printCommandLevels(levels: ExecutionLevel[]): void {
    console.log('\nGenerated deployment commands (dry-run mode):\n');

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      console.log(`# ── Level ${i} (${level.length} resource${level.length > 1 ? 's, parallel' : ''}) ──`);

      for (const { resource, commands } of level) {
        console.log(`# ${resource.type}.${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})`);
        for (const command of commands) {
          console.log(this.commandToShellLine(command));
        }
        console.log('');
      }
    }

    console.log('Use --execute flag to actually run these commands');
    console.log('Use --output-file <file> to write commands to a file');
  }

  /**
   * Write commands grouped by level to shell script file.
   * Capture commands are emitted as VARNAME=$(command args).
   */
  private async writeCommandLevelsToFile(
    levels: ExecutionLevel[],
    outputFile: string
  ): Promise<void> {
    const lines = ['#!/bin/bash', '', '# Generated by Merlin', ''];
    let totalCommands = 0;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      lines.push(`# ── Level ${i} (${level.length} resource${level.length > 1 ? 's, parallel' : ''}) ──`);

      for (const { resource, commands } of level) {
        lines.push(`# ${resource.type}.${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})`);
        for (const command of commands) {
          lines.push(this.commandToShellLine(command));
          totalCommands++;
        }
        lines.push('');
      }
    }

    await fs.writeFile(outputFile, lines.join('\n'), { mode: 0o755 });
    console.log(`✅ Deployment commands written to: ${outputFile}`);
    console.log(`   Total commands: ${totalCommands}`);
  }
}

/**
 * Expands $VARNAME references in a string using the provided map.
 * Only replaces variables that are present in the map; unknown $VARNAME
 * references are left as-is (so shell can handle them).
 */
function expandVars(arg: string, captureVars: Map<string, string>): string {
  return arg.replace(/\$([A-Z][A-Z0-9_]*)/g, (match, varName) => {
    return captureVars.has(varName) ? captureVars.get(varName)! : match;
  });
}

// Export singleton instance
export const deployer = new Deployer();
