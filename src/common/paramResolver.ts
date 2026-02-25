/**
 * Runtime parameter resolver.
 *
 * Resolves all ParamValue entries in resource.config at deploy time,
 * replacing them with actual string values obtained by:
 *   - Reading resource.ring / resource.region (synchronous)
 *   - Executing ProprietyGetter commands to fetch dependency export values (async)
 */

import { Resource } from './resource.js';
import { getResource } from './registry.js';
import { ParamValue, ParamSegment, isParamValue } from '../compiler/types.js';
import { execa } from 'execa';

/**
 * Resolves all ParamValue entries in resource.config, returning a new resource
 * with a fully resolved config where all values are plain strings/numbers/booleans/etc.
 *
 * Must be called at the start of Render.render() before accessing config fields.
 * This is handled automatically by AzureResourceRender.render() via the Template Method pattern.
 *
 * @throws Error if a dependency resource cannot be found in the registry
 * @throws Error if a referenced export does not exist on the dependency resource
 */
export async function resolveConfig<T extends Resource>(resource: T): Promise<T> {
    const resolvedConfig = await walkAndResolve(resource.config as Record<string, unknown>, resource);
    return { ...resource, config: resolvedConfig as T['config'] };
}

async function walkAndResolve(
    value: unknown,
    resource: Resource
): Promise<unknown> {
    if (isParamValue(value)) {
        return resolveParamValue(value, resource);
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map(item => walkAndResolve(item, resource)));
    }
    if (typeof value === 'object' && value !== null) {
        const result: Record<string, unknown> = {};
        await Promise.all(
            Object.entries(value as Record<string, unknown>).map(async ([k, v]) => {
                result[k] = await walkAndResolve(v, resource);
            })
        );
        return result;
    }
    // number, boolean, null, plain string → return as-is
    return value;
}

async function resolveParamValue(
    param: ParamValue,
    resource: Resource
): Promise<string> {
    const parts = await Promise.all(
        param.segments.map(seg => resolveSegment(seg, resource))
    );
    return parts.join('');
}

async function resolveSegment(
    seg: ParamSegment,
    resource: Resource
): Promise<string> {
    switch (seg.type) {
        case 'literal':
            return seg.value;

        case 'self':
            if (seg.field === 'ring') return resource.ring;
            if (seg.field === 'region') return resource.region ?? '';
            // TypeScript exhaustiveness — should never happen
            throw new Error(`Unknown self field: ${(seg as { field: string }).field}`);

        case 'dep': {
            // Resolve the dependency resource from the registry
            const depResource = getResource(seg.resource, resource.ring, resource.region);
            if (!depResource) {
                throw new Error(
                    `Cannot resolve parameter "\${ ${seg.resource}.${seg.export} }": ` +
                    `no resource named "${seg.resource}" registered for ring="${resource.ring}"` +
                    (resource.region ? `, region="${resource.region}"` : '')
                );
            }

            // Get the export definition
            const exportDef = depResource.exports[seg.export];
            if (!exportDef) {
                const available = Object.keys(depResource.exports).join(', ') || '(none)';
                throw new Error(
                    `Cannot resolve parameter "\${ ${seg.resource}.${seg.export} }": ` +
                    `resource "${seg.resource}" does not have an export named "${seg.export}". ` +
                    `Available exports: ${available}`
                );
            }

            // Call the ProprietyGetter to get the commands
            const commands = await exportDef.getter.get(depResource, exportDef.args);
            if (!commands.length) {
                throw new Error(
                    `ProprietyGetter "${exportDef.getter.name}" for "${seg.resource}.${seg.export}" returned no commands`
                );
            }

            // Execute the last command to get the value
            const lastCmd = commands[commands.length - 1];
            const { stdout } = await execa(lastCmd.command, lastCmd.args);

            // Use resultParser if available, otherwise use stdout directly
            if (lastCmd.resultParser) {
                return lastCmd.resultParser(stdout.trim());
            }
            return stdout.trim();
        }
    }
}
