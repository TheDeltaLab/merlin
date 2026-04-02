/**
 * Azure pre-deploy provider.
 *
 * Handles resource group deduplication and creation before individual
 * Azure resources are deployed. This is the Azure implementation of the
 * cloud-agnostic PreDeployProvider interface.
 */

import { Resource, Command, PreDeployProvider, Region } from '../common/resource.js';
import { AzureResourceGroupRender } from './resourceGroup.js';

export class AzurePreDeployProvider implements PreDeployProvider {
    async renderPreDeployLevel(resources: Resource[]): Promise<{ resource: Resource; commands: Command[] }[]> {
        const rgRender = new AzureResourceGroupRender();
        const seen = new Map<string, { resource: Resource; commands: Command[] }>();

        for (const r of resources) {
            // Skip Kubernetes resources — they use kubectl/helm, not Azure ARM,
            // and don't need Azure resource groups.
            if (r.type.startsWith('Kubernetes')) continue;

            const config = r.config as Record<string, unknown>;
            const hasCustomRG = config?.resourceGroupName && typeof config.resourceGroupName === 'string';

            // Skip resources that don't have a region AND no custom resourceGroupName.
            // Global resources with a custom RG (e.g. shared ACR) still need RG creation.
            if (!r.region && !hasCustomRG) continue;

            const rgName = rgRender.getResourceGroupName(r);
            if (!seen.has(rgName)) {
                // Location must come from the resource's region or explicit config.
                // We do NOT fall back to a hardcoded default — if neither is set,
                // the resource is skipped (global resources without a custom RG
                // are already filtered above).
                const location = r.region ?? (config?.location as string);
                if (!location) continue;

                // Build a minimal synthetic resource with only the fields RG render needs.
                const rgResource: Resource = {
                    name: `rg:${rgName}`,
                    type: 'AzureResourceGroup',
                    ring: r.ring,
                    region: (location as Region),
                    project: r.project,
                    dependencies: [],
                    config: hasCustomRG ? { resourceGroupName: config.resourceGroupName } : {},
                    exports: {},
                };
                const commands = await rgRender.render(rgResource);
                if (commands.length > 0) {
                    seen.set(rgName, { resource: rgResource, commands });
                }
            }
        }

        return [...seen.values()];
    }
}
