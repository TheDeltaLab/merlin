import { Resource, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { isResourceNotFoundError, execAsync } from '../common/constants.js';

export const AZURE_RESOURCE_GROUP = 'AzureResourceGroup';

export interface ResourceGroupProperty {
    name: string;
    location: string;
    tags?: Record<string, string>;
}

export class AzureResourceGroupRender extends AzureResourceRender {
    getShortResourceTypeName(): string {
        return 'rg';
    }
    supportConnectorInResourceName: boolean = true;

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        // Check if resource group already exists
        const deployedProps = await this.getDeployedProps(resource);

        // If resource group doesn't exist, create it
        if (!deployedProps) {
            return this.renderCreate(resource);
        }

        // Resource group already exists, no commands needed (idempotent)
        return [];
    }

    private async getDeployedProps(resource: Resource): Promise<ResourceGroupProperty | undefined> {
        const resourceGroupName = this.getResourceGroupName(resource);

        try {
            // Execute az group show command (suppress stderr via execa pipe)
            const result = await execAsync('az', ['group', 'show', '--name', resourceGroupName]);

            const deployedProps = JSON.parse(result);

            // Map Azure CLI response to ResourceGroupProperty
            return {
                name: deployedProps.name,
                location: deployedProps.location,
                tags: deployedProps.tags
            };
        } catch (error: any) {
            if (isResourceNotFoundError(error)) {
                return undefined;
            }
            throw new Error(
                `Failed to get deployed properties for resource group ${resourceGroupName}: ${error}`
            );
        }
    }

    private renderCreate(resource: Resource): Command[] {
        // Location must be explicitly set via resource.region or config.location.
        // No implicit default — callers must provide a region.
        const config = resource.config as Record<string, unknown>;
        const location = resource.region ?? config?.location as string;

        if (!location) {
            throw new Error(
                `Resource group for "${resource.name}" has no location. ` +
                `Set 'region' on the resource or 'location' in config.`
            );
        }

        const resourceGroupName = this.getResourceGroupName(resource);
        const args: string[] = [
            'group', 'create',
            '--name', resourceGroupName,
            '--location', location
        ];

        // Add tags if provided in config
        const tags = (resource.config as any)?.tags;
        this.addTags(args, tags);

        return [
            {
                command: 'az',
                args: args
            }
        ];
    }
}
