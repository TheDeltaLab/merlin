import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE = 'AzureContainerRegistry';

// refer to: https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest

// SKU options
export type ContainerRegistrySku = 'Basic' | 'Premium' | 'Standard';

// Default action for network rules
export type DefaultAction = 'Allow' | 'Deny';

// DNL scope options
export type DnlScope = 'NoReuse' | 'ResourceGroupReuse' | 'SubscriptionReuse' | 'TenantReuse' | 'Unsecure';

// Role assignment mode
export type RoleAssignmentMode = 'rbac' | 'rbac-abac';

// Zone redundancy
export type ZoneRedundancy = 'Disabled' | 'Enabled';

export interface AzureContainerRegistryConfig extends ResourceSchema {
    // Required configuration
    sku?: ContainerRegistrySku;

    // Optional configuration
    adminEnabled?: boolean;
    allowExports?: boolean;
    allowMetadataSearch?: boolean;
    allowTrustedServices?: boolean;
    defaultAction?: DefaultAction;
    dnlScope?: DnlScope;
    identity?: string;
    keyEncryptionKey?: string;
    location?: string;
    publicNetworkEnabled?: boolean;
    roleAssignmentMode?: RoleAssignmentMode;
    tags?: Record<string, string>;
    workspace?: string;
    zoneRedundancy?: ZoneRedundancy;

    // Update-only options
    anonymousPullEnabled?: boolean;
    dataEndpointEnabled?: boolean;
}

export interface AzureContainerRegistryResource extends AzureResource<AzureContainerRegistryConfig> {

}

export class AzureContainerRegistryRender extends AzureResourceRender {

    supportConnectorInResourceName: boolean = false;

    async render(resource: Resource): Promise<Command[]> {
        if (!AzureContainerRegistryRender.isAzureContainerRegistryResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure Container Registry resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource);
        ret.push(...rgCommands);

        // Get deployed properties to check if container registry exists
        const deployedProps = await this.getDeployedProps(resource);

        // If resource doesn't exist, create it; otherwise, update it
        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureContainerRegistryResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureContainerRegistryResource));
        }

        return ret;
    }

    private static isAzureContainerRegistryResource(resource: Resource): resource is AzureContainerRegistryResource {
        return resource.type === AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE;
    }

    private async getDeployedProps(resource: Resource): Promise<AzureContainerRegistryConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            // Execute az acr show command
            const result = execSync(
                `az acr show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const deployedProps = JSON.parse(result);

            // Map Azure CLI response to AzureContainerRegistryConfig
            const config: AzureContainerRegistryConfig = {
                // SKU
                sku: deployedProps.sku?.name as ContainerRegistrySku,

                // Basic configuration
                location: deployedProps.location,
                adminEnabled: deployedProps.adminUserEnabled,

                // Network configuration
                publicNetworkEnabled: deployedProps.publicNetworkAccess === 'Enabled',
                defaultAction: deployedProps.networkRuleSet?.defaultAction as DefaultAction,

                // Security and access
                allowTrustedServices: deployedProps.networkRuleSet?.azureAdAuthenticationAsArmPolicy?.enabled,

                // Zone redundancy
                zoneRedundancy: deployedProps.zoneRedundancy as ZoneRedundancy,

                // Identity
                identity: deployedProps.identity?.type,

                // Tags
                tags: deployedProps.tags,

                // Update-only properties
                anonymousPullEnabled: deployedProps.anonymousPullEnabled,
                dataEndpointEnabled: deployedProps.dataEndpointEnabled,
            };

            // Remove undefined values to keep the config clean
            return Object.fromEntries(
                Object.entries(config).filter(([_, v]) => v !== undefined)
            ) as AzureContainerRegistryConfig;

        } catch (error: any) {
            // If the command failed, it likely means the resource doesn't exist
            // The 2>/dev/null suppresses stderr, so we check the error status
            // Azure CLI returns exit code 3 when resource is not found
            if (error.status === 3 || error.status === 1) {
                return undefined;
            }

            // For other errors, check if it's a "not found" error
            const errorMessage = error.message || String(error);
            const stderr = error.stderr?.toString() || '';
            const combinedError = errorMessage + ' ' + stderr;

            if (combinedError.includes('ResourceNotFound') ||
                combinedError.includes('ResourceGroupNotFound') ||
                combinedError.includes('was not found') ||
                combinedError.includes('could not be found')) {
                return undefined;
            }

            // For genuine errors, throw them
            throw new Error(
                `Failed to get deployed properties for container registry ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    /**
     * Configuration mapping for simple key-value parameters
     * Maps config property names to their corresponding CLI flags
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'sku': '--sku',
        'location': '--location',
        'defaultAction': '--default-action',
        'dnlScope': '--dnl-scope',
        'identity': '--identity',
        'keyEncryptionKey': '--key-encryption-key',
        'roleAssignmentMode': '--role-assignment-mode',
        'workspace': '--workspace',
        'zoneRedundancy': '--zone-redundancy',
    };

    /**
     * Configuration mapping for boolean flags
     * Maps config property names to their corresponding CLI flags
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'adminEnabled': '--admin-enabled',
        'allowExports': '--allow-exports',
        'allowMetadataSearch': '--allow-metadata-search',
        'allowTrustedServices': '--allow-trusted-services',
        'publicNetworkEnabled': '--public-network-enabled',
    };

    /**
     * Boolean flags that are only available for update command
     */
    private static readonly UPDATE_ONLY_BOOLEAN_FLAG_MAP: Record<string, string> = {
        'anonymousPullEnabled': '--anonymous-pull-enabled',
        'dataEndpointEnabled': '--data-endpoint-enabled',
    };

    renderCreate(resource: AzureContainerRegistryResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('acr', 'create');

        // Required parameters
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Add all optional parameters using helper methods (only added if present in config)
        this.addSimpleParams(args, config, AzureContainerRegistryRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerRegistryRender.BOOLEAN_FLAG_MAP);
        this.addTags(args, config.tags);

        return [{
            command: 'az',
            args: args
        }];
    }

    renderUpdate(resource: AzureContainerRegistryResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('acr', 'update');

        // Required parameters
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Add all optional parameters using helper methods
        this.addSimpleParams(args, config, AzureContainerRegistryRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerRegistryRender.BOOLEAN_FLAG_MAP);
        this.addBooleanFlags(args, config, AzureContainerRegistryRender.UPDATE_ONLY_BOOLEAN_FLAG_MAP);
        this.addTags(args, config.tags);

        return [{
            command: 'az',
            args: args
        }];
    }

    override getShortResourceTypeName(): string {
        return 'acr';
    }
}
