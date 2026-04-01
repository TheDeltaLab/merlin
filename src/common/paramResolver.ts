/**
 * Runtime parameter resolver.
 *
 * Resolves all ParamValue entries in resource.config at deploy time,
 * replacing them with shell variable references ($MERLIN_<TYPE>_<NAME>_<RING>[_<REGION>]_<EXPORT>)
 * and collecting the corresponding capture commands (with envCapture set)
 * that must be emitted before the resource's own deployment commands.
 *
 * This deferred approach means no Azure API calls are made at render time —
 * all live queries are represented as shell commands in the final output,
 * so dry-run works correctly even when resources don't exist yet.
 */

import { Resource, Command, getRender, RING_SHORT_NAME_MAP, REGION_SHORT_NAME_MAP } from './resource.js';
import { getResource } from './registry.js';
import { ParamValue, ParamSegment, isParamValue } from '../compiler/types.js';

/**
 * Result returned by resolveConfig.
 */
export interface ResolveConfigResult<T extends Resource> {
    /**
     * The resource with all ParamValue entries replaced by shell variable
     * references such as "$MERLIN_ACR_CHUANGACR_STG_EAS_SERVER".
     */
    resource: T;

    /**
     * Shell capture commands to prepend before the resource's own commands.
     * Each has envCapture set to the variable name that receives its stdout.
     * These are deduplicated — each export is only captured once even if
     * referenced multiple times in the config.
     */
    captureCommands: Command[];
}

/**
 * Resolves all ParamValue entries in resource.config.
 *
 * Instead of executing ProprietyGetter commands eagerly (which requires the
 * Azure resources to already exist), this function:
 *   1. Collects the getter commands as capture commands (envCapture set)
 *   2. Substitutes "$MERLIN_<TYPE>_<NAME>_<RING>[_<REGION>]_<EXPORT>" strings into config values
 *
 * Must be called at the start of Render.render() before accessing config fields.
 * This is handled automatically by AzureResourceRender.render() via the
 * Template Method pattern.
 *
 * @throws Error if a dependency resource cannot be found in the registry
 * @throws Error if a referenced export does not exist on the dependency resource
 * @throws Error if a ProprietyGetter returns no commands
 */
export async function resolveConfig<T extends Resource>(resource: T): Promise<ResolveConfigResult<T>> {
    const captureCommands: Command[] = [];
    const seen = new Set<string>(); // dedup by varName

    const resolvedConfig = await walkAndResolve(
        resource.config as Record<string, unknown>,
        resource,
        captureCommands,
        seen
    );

    return {
        resource: { ...resource, config: resolvedConfig as T['config'] },
        captureCommands,
    };
}

async function walkAndResolve(
    value: unknown,
    resource: Resource,
    captureCommands: Command[],
    seen: Set<string>
): Promise<unknown> {
    if (isParamValue(value)) {
        return resolveParamValue(value, resource, captureCommands, seen);
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map(item => walkAndResolve(item, resource, captureCommands, seen)));
    }
    if (typeof value === 'object' && value !== null) {
        const result: Record<string, unknown> = {};
        await Promise.all(
            Object.entries(value as Record<string, unknown>).map(async ([k, v]) => {
                result[k] = await walkAndResolve(v, resource, captureCommands, seen);
            })
        );
        return result;
    }
    // number, boolean, null, plain string → return as-is
    return value;
}

async function resolveParamValue(
    param: ParamValue,
    resource: Resource,
    captureCommands: Command[],
    seen: Set<string>
): Promise<string> {
    const parts = await Promise.all(
        param.segments.map(seg => resolveSegment(seg, resource, captureCommands, seen))
    );
    return parts.join('');
}

async function resolveSegment(
    seg: ParamSegment,
    resource: Resource,
    captureCommands: Command[],
    seen: Set<string>
): Promise<string> {
    switch (seg.type) {
        case 'literal':
            return seg.value;

        case 'self':
            if (seg.field === 'ring') return resource.ring ?? '';
            if (seg.field === 'region') return resource.region ?? '';
            // TypeScript exhaustiveness — should never happen
            throw new Error(`Unknown self field: ${(seg as { field: string }).field}`);

        case 'dep': {
            // Resolve the dependency resource from the registry
            const depResource = getResource(seg.resourceType, seg.resource, resource.ring, resource.region);
            if (!depResource) {
                throw new Error(
                    `Cannot resolve parameter "\${ ${seg.resourceType}.${seg.resource}.${seg.export} }": ` +
                    `no resource "${seg.resourceType}.${seg.resource}" registered` +
                    (resource.ring ? ` for ring="${resource.ring}"` : '') +
                    (resource.region ? `, region="${resource.region}"` : '')
                );
            }

            // Get the export definition
            const exportDef = depResource.exports[seg.export];
            if (!exportDef) {
                const available = Object.keys(depResource.exports).join(', ') || '(none)';
                throw new Error(
                    `Cannot resolve parameter "\${ ${seg.resourceType}.${seg.resource}.${seg.export} }": ` +
                    `resource "${seg.resourceType}.${seg.resource}" does not have an export named "${seg.export}". ` +
                    `Available exports: ${available}`
                );
            }

            // Derive the shell variable name: MERLIN_<TYPE>_<NAME>_<RING>[_<REGION>]_<EXPORT>
            const varName = toVarName(seg.resourceType, seg.resource, seg.export, resource.ring, resource.region);

            // Only add the capture command once (dedup by varName)
            if (!seen.has(varName)) {
                seen.add(varName);

                // Call the ProprietyGetter to get the commands
                const commands = await exportDef.getter.get(depResource, exportDef.args);
                if (!commands.length) {
                    throw new Error(
                        `ProprietyGetter "${exportDef.getter.name}" for "${seg.resourceType}.${seg.resource}.${seg.export}" returned no commands`
                    );
                }

                // Use the last command as the capture command
                const lastCmd = commands[commands.length - 1];
                captureCommands.push({ ...lastCmd, envCapture: varName });
            }

            // Return the shell variable reference
            return `$${varName}`;
        }
    }
}

/**
 * Converts a dependency reference + the calling resource's ring/region into
 * a unique uppercase shell variable name.
 *
 * Uses short names for type (via Render.getShortResourceTypeName()),
 * ring (RING_SHORT_NAME_MAP) and region (REGION_SHORT_NAME_MAP) to keep
 * variable names concise while guaranteeing uniqueness across ring×region.
 *
 * Example: ("AzureContainerRegistry", "chuangacr", "server", "staging", "eastasia")
 *        → "MERLIN_ACR_CHUANGACR_STG_EAS_SERVER"
 */
function toVarName(
    resourceType: string,
    resource: string,
    exportName: string,
    ring?: string,
    region?: string
): string {
    const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    // Use short type name from the Render implementation
    let shortType: string;
    try {
        shortType = getRender(resourceType).getShortResourceTypeName();
    } catch {
        shortType = resourceType; // fallback to full type name
    }

    const shortRing = ring
        ? RING_SHORT_NAME_MAP[ring as keyof typeof RING_SHORT_NAME_MAP] ?? ring
        : undefined;
    const shortRegion = region
        ? REGION_SHORT_NAME_MAP[region as keyof typeof REGION_SHORT_NAME_MAP] ?? region
        : undefined;

    const parts = [
        'MERLIN',
        slug(shortType),
        slug(resource),
    ];
    if (shortRing) parts.push(slug(shortRing));
    if (shortRegion) parts.push(slug(shortRegion));
    parts.push(slug(exportName));
    return parts.join('_');
}
