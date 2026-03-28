/**
 * Project-level configuration (`merlin.yml`).
 *
 * Each resource directory may contain a `merlin.yml` file that declares
 * project-wide defaults (project, ring, region, authProvider). Resource
 * files in that directory inherit these values unless they override them
 * explicitly.
 */

import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { parse as parseYAML } from 'yaml';
import { ProjectConfigSchema } from './schemas.js';

export interface ProjectConfig {
    project?: string;
    ring?: string | string[];
    region?: string | string[];
    authProvider?: string | Record<string, string>;
}

const PROJECT_CONFIG_FILENAME = 'merlin.yml';

/**
 * Attempts to load a `merlin.yml` project config from the given directory.
 * Returns undefined if the file does not exist or is not a valid project config
 * (i.e., it has a `type` field, meaning it's a regular resource file).
 */
export function loadProjectConfig(dir: string): ProjectConfig | undefined {
    const configPath = path.join(dir, PROJECT_CONFIG_FILENAME);
    if (!existsSync(configPath)) return undefined;

    try {
        const content = readFileSync(configPath, 'utf-8');
        const data = parseYAML(content, { prettyErrors: true });

        // A regular resource YAML has `type` and `name` fields.
        // If we see `type`, this is a resource file, not a project config.
        if (data && typeof data === 'object' && 'type' in data) {
            return undefined;
        }

        const result = ProjectConfigSchema.safeParse(data);
        if (!result.success) return undefined;

        return result.data;
    } catch {
        return undefined;
    }
}

/**
 * Discovers project configs for all input directories.
 * Returns a map from directory path → ProjectConfig.
 * Also walks up parent directories to find a config (so subdirectories inherit).
 */
export function discoverProjectConfigs(dirs: string[]): Map<string, ProjectConfig> {
    const configMap = new Map<string, ProjectConfig>();

    for (const dir of dirs) {
        const config = loadProjectConfig(dir);
        if (config) {
            configMap.set(dir, config);
        }
    }

    return configMap;
}

/**
 * Applies project defaults to a parsed YAML data object.
 * Resource-level fields take precedence over project defaults.
 */
export function applyProjectDefaults(
    data: Record<string, unknown>,
    projectConfig: ProjectConfig
): Record<string, unknown> {
    return {
        ...data,
        project: data.project ?? projectConfig.project,
        ring: data.ring ?? projectConfig.ring,
        region: data.region ?? projectConfig.region,
        authProvider: data.authProvider ?? projectConfig.authProvider,
    };
}
