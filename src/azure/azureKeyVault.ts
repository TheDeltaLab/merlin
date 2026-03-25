import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_KEY_VAULT_RESOURCE_TYPE = 'AzureKeyVault';

// refer to: https://learn.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest#az-keyvault-create

export interface AzureKeyVaultConfig extends ResourceSchema {
    /** Key Vault SKU: 'standard' or 'premium' */
    sku?: string;
    /** Location (e.g. 'koreacentral'). Only used on create. */
    location?: string;
    /** Enable RBAC authorization (recommended over access policies) */
    enableRbacAuthorization?: boolean;
    /** Enable soft delete */
    enableSoftDelete?: boolean;
    /** Soft delete retention in days (7–90) */
    softDeleteRetentionInDays?: number;
    /** Enable purge protection */
    enablePurgeProtection?: boolean;
    /** Tags */
    tags?: Record<string, string>;
}

export interface AzureKeyVaultResource extends Resource<AzureKeyVaultConfig> {}

/**
 * Azure Key Vault Render.
 *
 * On create:
 *   1. Ensure resource group
 *   2. az keyvault create ...
 *
 * On update:
 *   1. az keyvault update ...
 *
 * Key Vault names must be globally unique, 3–24 characters, alphanumeric and hyphens only.
 * Using supportConnectorInResourceName = false to keep names compact.
 */
export class AzureKeyVaultRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = false;

    override getShortResourceTypeName(): string {
        return 'akv';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureKeyVaultRender.isAzureKeyVaultResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an AzureKeyVault resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureKeyVaultResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureKeyVaultResource));
        }

        return ret;
    }

    private static isAzureKeyVaultResource(resource: Resource): resource is AzureKeyVaultResource {
        return resource.type === AZURE_KEY_VAULT_RESOURCE_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzureKeyVaultConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = execSync(
                `az keyvault show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const d = JSON.parse(result);

            const config: AzureKeyVaultConfig = {
                sku: d.properties?.sku?.name,
                enableRbacAuthorization: d.properties?.enableRbacAuthorization,
                enableSoftDelete: d.properties?.enableSoftDelete,
                softDeleteRetentionInDays: d.properties?.softDeleteRetentionDays,
                enablePurgeProtection: d.properties?.enablePurgeProtection,
                tags: d.tags,
            };

            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzureKeyVaultConfig;

        } catch (error: any) {
            if (error.status === 3 || error.status === 1) {
                return undefined;
            }

            const errorMessage = error.message || String(error);
            const stderr = error.stderr?.toString() || '';
            const combinedError = errorMessage + ' ' + stderr;

            if (combinedError.includes('ResourceNotFound') ||
                combinedError.includes('ResourceGroupNotFound') ||
                combinedError.includes('was not found') ||
                combinedError.includes('could not be found') ||
                combinedError.includes('VaultNotFound')) {
                return undefined;
            }

            throw new Error(
                `Failed to get deployed properties for Key Vault ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
    };

    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'sku': '--sku',
        'location': '--location',
        'softDeleteRetentionInDays': '--retention-days',
    };

    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableRbacAuthorization': '--enable-rbac-authorization',
        'enablePurgeProtection': '--enable-purge-protection',
    };

    // Note: --enable-soft-delete was removed in Azure CLI 2.50+.
    // Soft-delete is now mandatory and always enabled.
    private static readonly CREATE_ONLY_BOOLEAN_FLAG_MAP: Record<string, string> = {
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzureKeyVaultResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('keyvault', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzureKeyVaultRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzureKeyVaultRender.CREATE_ONLY_SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureKeyVaultRender.BOOLEAN_FLAG_MAP);
        this.addBooleanFlags(args, config, AzureKeyVaultRender.CREATE_ONLY_BOOLEAN_FLAG_MAP);
        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzureKeyVaultResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('keyvault', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzureKeyVaultRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureKeyVaultRender.BOOLEAN_FLAG_MAP);
        // Note: az keyvault update does not support --sku or --tags

        return [{ command: 'az', args }];
    }
}
