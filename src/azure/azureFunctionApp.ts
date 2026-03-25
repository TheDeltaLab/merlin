import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_FUNCTION_APP_RESOURCE_TYPE = 'AzureFunctionApp';

// refer to: https://learn.microsoft.com/en-us/cli/azure/functionapp?view=azure-cli-latest

export interface AzureFunctionAppConfig extends ResourceSchema {
    /** Container image (e.g. myacr.azurecr.io/myapp:tag) */
    image?: string;
    /** Container name (informational) */
    containerName?: string;
    /** CPU cores (e.g. 0.5, 1) — for container-on-ACAE hosting */
    cpu?: number;
    /** Memory (e.g. '1Gi') — for container-on-ACAE hosting */
    memory?: string;
    /** Storage account name or resource ID (required) */
    storageAccount?: string;
    /** Container App Environment name — for container-on-ACAE hosting */
    environment?: string;
    /** Azure Functions version (default '4') */
    functionsVersion?: string;
    /** Runtime stack: 'node' | 'python' | 'java' | 'dotnet' | etc. */
    runtime?: string;
    /** Runtime version (e.g. '20' for Node.js 20) */
    runtimeVersion?: string;
    /** Minimum replicas */
    minReplicas?: number;
    /** Maximum replicas */
    maxReplicas?: number;
    /** Consumption plan location (if not using environment) */
    consumptionPlanLocation?: string;
    /** Environment variables as KEY=VALUE strings */
    envVars?: string[];
    /** Tags */
    tags?: Record<string, string>;
}

export interface AzureFunctionAppResource extends Resource<AzureFunctionAppConfig> {}

/**
 * Azure Function App Render.
 *
 * Supports both container-based and consumption-plan deployments:
 *
 * Container-based (on Container App Environment):
 *   1. Ensure resource group
 *   2. az functionapp create --environment ... --image ... --cpu ... --memory ...
 *   3. az functionapp config appsettings set (env vars)
 *
 * Consumption plan:
 *   1. Ensure resource group
 *   2. az functionapp create --consumption-plan-location ... --runtime ... --functions-version ...
 *   3. az functionapp config appsettings set (env vars)
 *
 * On update:
 *   1. az functionapp config container set (update image for container-based)
 *   2. az functionapp config appsettings set (update env vars)
 */
export class AzureFunctionAppRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = true;

    override getShortResourceTypeName(): string {
        return 'func';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureFunctionAppRender.isFunctionAppResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an AzureFunctionApp resource`);
        }

        const ret: Command[] = [];

        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureFunctionAppResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureFunctionAppResource));
        }

        // Set environment variables (app settings) after create/update
        const config = resource.config as AzureFunctionAppConfig;
        if (config.envVars && config.envVars.length > 0) {
            ret.push(...this.renderAppSettings(resource as AzureFunctionAppResource));
        }

        return ret;
    }

    private static isFunctionAppResource(resource: Resource): resource is AzureFunctionAppResource {
        return resource.type === AZURE_FUNCTION_APP_RESOURCE_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzureFunctionAppConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = execSync(
                `az functionapp show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const d = JSON.parse(result);

            const config: AzureFunctionAppConfig = {
                tags: d.tags,
            };

            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzureFunctionAppConfig;

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
                combinedError.includes('could not be found')) {
                return undefined;
            }

            throw new Error(
                `Failed to get deployed properties for Function App ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzureFunctionAppResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('functionapp', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Storage account is required
        if (config.storageAccount) {
            args.push('--storage-account', config.storageAccount);
        }

        // Container-based deployment (on ACAE)
        if (config.image) {
            args.push('--image', config.image);
        }

        if (config.environment) {
            // Deploy to Container App Environment
            args.push('--environment', config.environment);
        } else if (config.consumptionPlanLocation) {
            // Consumption plan
            args.push('--consumption-plan-location', config.consumptionPlanLocation);
        }

        if (config.cpu !== undefined) {
            args.push('--cpu', String(config.cpu));
        }
        if (config.memory) {
            args.push('--memory', config.memory);
        }

        if (config.functionsVersion) {
            args.push('--functions-version', config.functionsVersion);
        }
        if (config.runtime) {
            args.push('--runtime', config.runtime);
        }
        if (config.runtimeVersion) {
            args.push('--runtime-version', config.runtimeVersion);
        }

        if (config.minReplicas !== undefined) {
            args.push('--min-replicas', String(config.minReplicas));
        }
        if (config.maxReplicas !== undefined) {
            args.push('--max-replicas', String(config.maxReplicas));
        }

        // Enable system-assigned managed identity
        args.push('--assign-identity', '[system]');

        this.addTags(args, config.tags);

        const commands: Command[] = [{ command: 'az', args }];

        // For consumption plan deployments, --assign-identity may be silently ignored.
        // Explicitly assign system-managed identity after create to ensure it's enabled.
        if (!config.environment) {
            commands.push({
                command: 'bash',
                args: ['-c', `az functionapp identity assign --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} || true`],
            });
        }

        return commands;
    }

    renderUpdate(resource: AzureFunctionAppResource): Command[] {
        const config = resource.config;
        const commands: Command[] = [];

        // Update container image if specified
        if (config.image) {
            commands.push({
                command: 'bash',
                args: ['-c', `az functionapp config container set --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} --image ${config.image} || true`],
            });
        }

        // Ensure system-assigned managed identity is enabled
        commands.push({
            command: 'bash',
            args: ['-c', `az functionapp identity assign --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} || true`],
        });

        return commands;
    }

    renderAppSettings(resource: AzureFunctionAppResource): Command[] {
        const config = resource.config;
        if (!config.envVars || config.envVars.length === 0) return [];

        const settings = config.envVars.join(' ');

        return [{
            command: 'az',
            args: [
                'functionapp', 'config', 'appsettings', 'set',
                '--name', this.getResourceName(resource),
                '--resource-group', this.getResourceGroupName(resource),
                '--settings', settings,
            ],
        }];
    }
}
