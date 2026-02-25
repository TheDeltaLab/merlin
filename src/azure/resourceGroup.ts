import { Resource, Command } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

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

    async render(resource: Resource): Promise<Command[]> {
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
            // Execute az group show command (suppress stderr to avoid printing errors)
            const result = execSync(
                `az group show --name ${resourceGroupName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const deployedProps = JSON.parse(result);

            // Map Azure CLI response to ResourceGroupProperty
            return {
                name: deployedProps.name,
                location: deployedProps.location,
                tags: deployedProps.tags
            };
        } catch (error: any) {
            // If the command failed, it likely means the resource group doesn't exist
            // The 2>/dev/null suppresses stderr, so we check the error status
            // Azure CLI returns exit code 3 when resource is not found
            if (error.status === 3 || error.status === 1) {
                return undefined;
            }

            // For other errors, check if it's a "not found" error
            const errorMessage = error.message || String(error);
            const stderr = error.stderr?.toString() || '';
            const combinedError = errorMessage + ' ' + stderr;

            if (combinedError.includes('ResourceGroupNotFound') ||
                combinedError.includes('was not found') ||
                combinedError.includes('could not be found')) {
                return undefined;
            }

            // For genuine errors, throw them
            throw new Error(
                `Failed to get deployed properties for resource group ${resourceGroupName}: ${error}`
            );
        }
    }

    private renderCreate(resource: Resource): Command[] {
        if (!resource.region) {
            throw new Error(`Region is required for creating resource group for resource ${resource.name}`);
        }

        const resourceGroupName = this.getResourceGroupName(resource);
        const args: string[] = [
            'group', 'create',
            '--name', resourceGroupName,
            '--location', resource.region
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
