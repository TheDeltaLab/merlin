/**
 * Deployment orchestration module
 * Handles resource deployment using render functions from the registry
 */

import { Resource, Command } from './common/resource.js';
import { getAllResources } from './common/registry.js';
import { getRender } from './common/resource.js';
import { execa } from 'execa';
import * as fs from 'fs/promises';

export interface DeployOptions {
  ring?: string;
  region?: string;
  execute: boolean;
  outputFile?: string;
}

export class Deployer {
  /**
   * Main deployment orchestration function
   */
  async deploy(options: DeployOptions): Promise<void> {
    // 1. Get all resources and filter by ring/region
    const filtered = this.filterResources(getAllResources(), options);

    if (filtered.length === 0) {
      console.log('No resources match the specified filters');
      return;
    }

    // 2. Sort by dependency order (dependencies render before dependents)
    const resources = this.sortByDependencies(filtered);

    // 3. Render commands for each resource
    const allCommands: Array<{ resource: Resource; commands: Command[] }> = [];

    for (const resource of resources) {
      console.log(`Rendering ${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})...`);

      try {
        const render = getRender(resource.type);
        const commands = await render.render(resource);
        allCommands.push({ resource, commands });
      } catch (error) {
        console.error(`Failed to render ${resource.name}:`, error);
        throw error;
      }
    }

    // 3. Output or execute commands based on options
    if (options.outputFile) {
      await this.writeCommandsToFile(allCommands, options.outputFile);
    }

    if (options.execute) {
      await this.executeCommands(allCommands);
    } else if (!options.outputFile) {
      // Only print if not already writing to file
      this.printCommands(allCommands);
    }
  }

  /**
   * Sorts resources in topological order so dependencies are rendered before dependents.
   * Uses Kahn's BFS algorithm. Throws on circular dependencies.
   * Dependencies are matched by resource name — all resources with a given name
   * are treated as predecessors of any resource that declares a dependency on that name.
   */
  private sortByDependencies(resources: Resource[]): Resource[] {
    // Index resources by name for fast lookup
    const byName = new Map<string, Resource[]>();
    for (const r of resources) {
      const list = byName.get(r.name) ?? [];
      list.push(r);
      byName.set(r.name, list);
    }

    const resourceKey = (r: Resource) =>
      r.region ? `${r.name}:${r.ring}:${r.region}` : `${r.name}:${r.ring}`;

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
        for (const depResource of (byName.get(dep.resource) ?? [])) {
          const depKey = resourceKey(depResource);
          inDegree.set(rKey, inDegree.get(rKey)! + 1);
          dependents.get(depKey)!.add(rKey);
        }
      }
    }

    // Kahn's BFS
    const queue: string[] = [];
    for (const [key, degree] of inDegree) {
      if (degree === 0) queue.push(key);
    }

    const sorted: Resource[] = [];
    while (queue.length > 0) {
      const key = queue.shift()!;
      sorted.push(keyToResource.get(key)!);
      for (const sKey of dependents.get(key)!) {
        const newDeg = inDegree.get(sKey)! - 1;
        inDegree.set(sKey, newDeg);
        if (newDeg === 0) queue.push(sKey);
      }
    }

    if (sorted.length !== resources.length) {
      const cycleKeys = [...inDegree.entries()]
        .filter(([, d]) => d > 0)
        .map(([k]) => k);
      throw new Error(
        `Circular dependency detected among resources: ${cycleKeys.join(', ')}`
      );
    }

    return sorted;
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
   * Execute commands sequentially with error handling.
   *
   * Commands with `envCapture` are treated as capture steps:
   *   - Their stdout (post-resultParser) is stored in captureVars
   *   - Subsequent command args have $VARNAME references expanded from captureVars
   */
  private async executeCommands(
    allCommands: Array<{ resource: Resource; commands: Command[] }>
  ): Promise<void> {
    console.log('\nExecuting deployment commands...\n');

    // Shared in-memory map for captured variable values across all resources
    const captureVars = new Map<string, string>();

    for (const { resource, commands } of allCommands) {
      console.log(`Deploying ${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})...`);

      for (const command of commands) {
        const commandStr = this.commandToShellLine(command);
        console.log(`> ${commandStr}`);

        try {
          if (command.envCapture) {
            // Capture command: run it, parse result, store in map
            const { stdout } = await execa(command.command, command.args);
            const value = command.resultParser
              ? command.resultParser(stdout.trim())
              : stdout.trim();
            captureVars.set(command.envCapture, value);
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

    console.log('Deployment completed successfully!');
  }

  /**
   * Print commands without executing.
   * Capture commands are shown as VARNAME=$(command args).
   */
  private printCommands(allCommands: Array<{ resource: Resource; commands: Command[] }>): void {
    console.log('\nGenerated deployment commands (dry-run mode):\n');

    for (const { resource, commands } of allCommands) {
      console.log(`# ${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})`);
      for (const command of commands) {
        console.log(this.commandToShellLine(command));
      }
      console.log('');
    }

    console.log('Use --execute flag to actually run these commands');
    console.log('Use --output-file <file> to write commands to a file');
  }

  /**
   * Write commands to shell script file.
   * Capture commands are emitted as VARNAME=$(command args).
   */
  private async writeCommandsToFile(
    allCommands: Array<{ resource: Resource; commands: Command[] }>,
    outputFile: string
  ): Promise<void> {
    const lines = ['#!/bin/bash', '', '# Generated by Merlin', ''];

    for (const { resource, commands } of allCommands) {
      lines.push(`# ${resource.name} (${resource.ring}${resource.region ? `/${resource.region}` : ''})`);
      for (const command of commands) {
        lines.push(this.commandToShellLine(command));
      }
      lines.push('');
    }

    await fs.writeFile(outputFile, lines.join('\n'), { mode: 0o755 });
    console.log(`✅ Deployment commands written to: ${outputFile}`);
    console.log(`   Total commands: ${allCommands.reduce((sum, { commands }) => sum + commands.length, 0)}`);
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
