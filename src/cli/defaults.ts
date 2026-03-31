/**
 * CLI defaults — loads merlin.yml project config and extracts
 * the first ring/region as CLI default values.
 */

import { loadProjectConfig } from '../compiler/projectConfig.js';

export interface CLIDefaults {
    ring?: string;
    region?: string;
    project?: string;
}

/**
 * Reads merlin.yml from the given resource directory and extracts
 * CLI-usable default values (first ring, first region, project name).
 *
 * Returns undefined if merlin.yml doesn't exist or can't be parsed.
 */
export function loadCLIDefaults(resourceDir: string): CLIDefaults | undefined {
    const config = loadProjectConfig(resourceDir);
    if (!config) return undefined;

    const ring = Array.isArray(config.ring)
        ? config.ring[0]
        : config.ring;

    const region = Array.isArray(config.region)
        ? config.region[0]
        : config.region;

    return {
        ring,
        region,
        project: config.project,
    };
}
