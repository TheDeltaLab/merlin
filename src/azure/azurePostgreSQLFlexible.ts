import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { isResourceNotFoundError, execAsync } from '../common/constants.js';

export const AZURE_POSTGRESQL_RESOURCE_TYPE = 'AzurePostgreSQLFlexible';

// refer to: https://learn.microsoft.com/en-us/cli/azure/postgres/flexible-server?view=azure-cli-latest

export interface AzurePostgreSQLFlexibleConfig extends ResourceSchema {
    /** Azure region */
    location?: string;
    /** Compute SKU (e.g. Standard_D2ds_v4, Standard_B2ms) */
    skuName?: string;
    /** Compute tier: 'Burstable' | 'GeneralPurpose' | 'MemoryOptimized' */
    tier?: string;
    /** Storage size in GiB (min 32, default 128) */
    storageSizeGb?: number;
    /** PostgreSQL major version (e.g. '16') */
    version?: string;
    /** Backup retention in days (7–35, default 7) */
    backupRetention?: number;
    /** Geo-redundant backup: 'Enabled' | 'Disabled' */
    geoRedundantBackup?: string;
    /** High availability: 'Disabled' | 'SameZone' | 'ZoneRedundant' */
    highAvailability?: string;
    /** Public access: 'Enabled' | 'Disabled' | 'All' | 'None' | IP range */
    publicAccess?: string;
    /** Storage auto-grow: 'Enabled' | 'Disabled' */
    storageAutoGrow?: string;
    /** Tags */
    tags?: Record<string, string>;
}

export interface AzurePostgreSQLFlexibleResource extends Resource<AzurePostgreSQLFlexibleConfig> {}

/**
 * Azure PostgreSQL Flexible Server Render.
 *
 * On create:
 *   1. Ensure resource group
 *   2. az postgres flexible-server create ... --yes
 *
 * On update:
 *   1. az postgres flexible-server update ...
 *
 * PostgreSQL server names: lowercase, numbers, hyphens; 3–63 characters.
 */
export class AzurePostgreSQLFlexibleRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = false;

    override getShortResourceTypeName(): string {
        return 'psql';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzurePostgreSQLFlexibleRender.isPostgreSQLResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an AzurePostgreSQLFlexible resource`);
        }

        const ret: Command[] = [];

        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzurePostgreSQLFlexibleResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzurePostgreSQLFlexibleResource));
        }

        return ret;
    }

    private static isPostgreSQLResource(resource: Resource): resource is AzurePostgreSQLFlexibleResource {
        return resource.type === AZURE_POSTGRESQL_RESOURCE_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzurePostgreSQLFlexibleConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = await execAsync('az', ['postgres', 'flexible-server', 'show', '-g', resourceGroup, '-n', resourceName]);

            const d = JSON.parse(result);

            const config: AzurePostgreSQLFlexibleConfig = {
                skuName: d.sku?.name,
                tier: d.sku?.tier,
                storageSizeGb: d.storage?.storageSizeGb,
                version: d.version,
                highAvailability: d.highAvailability?.mode,
                tags: d.tags,
            };

            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzurePostgreSQLFlexibleConfig;

        } catch (error: any) {
            if (isResourceNotFoundError(error)) {
                return undefined;
            }
            throw new Error(
                `Failed to get deployed properties for PostgreSQL server ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'skuName': '--sku-name',
        'tier': '--tier',
    };

    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'location': '--location',
        'version': '--version',
        'publicAccess': '--public-access',
        'geoRedundantBackup': '--geo-redundant-backup',
    };

    private static readonly SIMPLE_PARAM_MAP_UPDATE: Record<string, string> = {
        'highAvailability': '--high-availability',
        'storageAutoGrow': '--storage-auto-grow',
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzurePostgreSQLFlexibleResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('postgres', 'flexible-server', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzurePostgreSQLFlexibleRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzurePostgreSQLFlexibleRender.CREATE_ONLY_SIMPLE_PARAM_MAP);

        // Storage size requires special handling (CLI uses --storage-size in GiB)
        if (config.storageSizeGb !== undefined) {
            args.push('--storage-size', String(config.storageSizeGb));
        }

        // Backup retention
        if (config.backupRetention !== undefined) {
            args.push('--backup-retention', String(config.backupRetention));
        }

        // High availability on create
        if (config.highAvailability) {
            args.push('--high-availability', config.highAvailability);
        }

        // Storage auto-grow on create
        if (config.storageAutoGrow) {
            args.push('--storage-auto-grow', config.storageAutoGrow);
        }

        this.addTags(args, config.tags);

        // --yes to skip interactive prompts
        args.push('--yes');

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzurePostgreSQLFlexibleResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('postgres', 'flexible-server', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzurePostgreSQLFlexibleRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzurePostgreSQLFlexibleRender.SIMPLE_PARAM_MAP_UPDATE);

        // Storage can only grow, not shrink
        if (config.storageSizeGb !== undefined) {
            args.push('--storage-size', String(config.storageSizeGb));
        }

        // Backup retention on update
        if (config.backupRetention !== undefined) {
            args.push('--backup-retention', String(config.backupRetention));
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }
}
