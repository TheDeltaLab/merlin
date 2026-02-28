import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE = 'AzureLogAnalyticsWorkspace';

// refer to: https://learn.microsoft.com/en-us/cli/azure/monitor/log-analytics/workspace

// SKU options
export type LogAnalyticsWorkspaceSku =
    | 'CapacityReservation'
    | 'Free'
    | 'LACluster'
    | 'PerGB2018'
    | 'PerNode'
    | 'Premium'
    | 'Standalone'
    | 'Standard';

// Access control options
export type LogAnalyticsIngestionAccess = 'Disabled' | 'Enabled';
export type LogAnalyticsQueryAccess = 'Disabled' | 'Enabled';

// Identity type options
export type LogAnalyticsIdentityType = 'None' | 'SystemAssigned' | 'UserAssigned';

// Capacity reservation levels (GB/day)
export type LogAnalyticsCapacityReservationLevel =
    | 100 | 200 | 300 | 400 | 500
    | 1000 | 2000 | 5000 | 10000 | 25000 | 50000;

export interface AzureLogAnalyticsWorkspaceConfig extends ResourceSchema {
    // ── SKU — CREATE ONLY (immutable after creation) ──────────────────────
    sku?: LogAnalyticsWorkspaceSku;                                     // --sku

    // ── Core settings ─────────────────────────────────────────────────────
    location?: string;                                                    // --location
    retentionInDays?: number;                                             // --retention-time
    dailyQuotaGb?: number;                                                // --quota (-1 = unlimited)

    // ── Capacity reservation ───────────────────────────────────────────────
    capacityReservationLevel?: LogAnalyticsCapacityReservationLevel;      // --capacity-reservation-level

    // ── Access control ────────────────────────────────────────────────────
    ingestionAccess?: LogAnalyticsIngestionAccess;                        // --ingestion-access
    queryAccess?: LogAnalyticsQueryAccess;                                // --query-access

    // ── Replication ───────────────────────────────────────────────────────
    replicationEnabled?: boolean;                                         // --replication-enabled (true/false)
    replicationLocation?: string;                                         // --replication-location

    // ── Identity ─────────────────────────────────────────────────────────
    identityType?: LogAnalyticsIdentityType;                              // --identity-type
    userAssignedIdentities?: string[];                                    // --user-assigned (space-joined resource IDs)

    // ── Misc ─────────────────────────────────────────────────────────────
    /**
     * Presence-only flag — when true, '--no-wait' is appended without a value.
     */
    noWait?: boolean;                                                     // --no-wait
    tags?: Record<string, string>;                                        // --tags
}

export interface AzureLogAnalyticsWorkspaceResource
    extends AzureResource<AzureLogAnalyticsWorkspaceConfig> {}

export class AzureLogAnalyticsWorkspaceRender extends AzureResourceRender {

    /** Workspace names support hyphens */
    supportConnectorInResourceName: boolean = true;

    override getShortResourceTypeName(): string {
        return 'law';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureLogAnalyticsWorkspaceRender.isAzureLogAnalyticsWorkspaceResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure Log Analytics Workspace resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        // Get deployed properties to check if workspace exists
        const deployedProps = await this.getDeployedProps(resource);

        // If resource doesn't exist, create it; otherwise, update it
        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureLogAnalyticsWorkspaceResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureLogAnalyticsWorkspaceResource));
        }

        return ret;
    }

    private static isAzureLogAnalyticsWorkspaceResource(resource: Resource): resource is AzureLogAnalyticsWorkspaceResource {
        return resource.type === AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE;
    }

    private async getDeployedProps(resource: Resource): Promise<AzureLogAnalyticsWorkspaceConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = execSync(
                `az monitor log-analytics workspace show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const d = JSON.parse(result);

            // Extract user-assigned identity resource IDs (keys of the identities map)
            const userAssignedIds: string[] | undefined =
                d.identity?.userAssignedIdentities && Object.keys(d.identity.userAssignedIdentities).length > 0
                    ? Object.keys(d.identity.userAssignedIdentities)
                    : undefined;

            const config: AzureLogAnalyticsWorkspaceConfig = {
                sku:                      d.sku?.name                                          as LogAnalyticsWorkspaceSku,
                location:                 d.location,
                retentionInDays:          d.properties?.retentionInDays,
                dailyQuotaGb:             d.properties?.workspaceCapping?.dailyQuotaGb,
                capacityReservationLevel: d.sku?.capacityReservationLevel                      as LogAnalyticsCapacityReservationLevel | undefined,
                ingestionAccess:          d.properties?.publicNetworkAccessForIngestion         as LogAnalyticsIngestionAccess,
                queryAccess:              d.properties?.publicNetworkAccessForQuery             as LogAnalyticsQueryAccess,
                replicationEnabled:       d.properties?.replication?.enabled,
                replicationLocation:      d.properties?.replication?.location ?? undefined,
                identityType:             d.identity?.type                                     as LogAnalyticsIdentityType,
                userAssignedIdentities:   userAssignedIds,
                tags:                     d.tags,
            };

            // Remove undefined and null values to keep the config clean
            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined && v !== null)
            ) as AzureLogAnalyticsWorkspaceConfig;

        } catch (error: any) {
            // Azure CLI returns exit code 3 when resource is not found
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
                `Failed to get deployed properties for log analytics workspace ` +
                `${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    /**
     * Parameters valid on both create and update
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'location':                  '--location',
        'retentionInDays':           '--retention-time',
        'dailyQuotaGb':              '--quota',
        'capacityReservationLevel':  '--capacity-reservation-level',
        'ingestionAccess':           '--ingestion-access',
        'queryAccess':               '--query-access',
        'replicationLocation':       '--replication-location',
        'identityType':              '--identity-type',
    };

    /**
     * Parameters valid on CREATE only — --sku is immutable after creation
     */
    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'sku': '--sku',
    };

    /**
     * Boolean flags (emits --flag true/false) valid on both create and update
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'replicationEnabled': '--replication-enabled',
    };

    /**
     * Array params (space-joined) valid on both create and update
     */
    private static readonly ARRAY_PARAM_MAP: Record<string, string> = {
        'userAssignedIdentities': '--user-assigned',
    };

    renderCreate(resource: AzureLogAnalyticsWorkspaceResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('monitor', 'log-analytics', 'workspace', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Parameters valid on both create and update
        this.addSimpleParams(args, config, AzureLogAnalyticsWorkspaceRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureLogAnalyticsWorkspaceRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureLogAnalyticsWorkspaceRender.ARRAY_PARAM_MAP);

        // Parameters valid on CREATE only
        this.addSimpleParams(args, config, AzureLogAnalyticsWorkspaceRender.CREATE_ONLY_SIMPLE_PARAM_MAP);

        // Presence-only flag (no value)
        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzureLogAnalyticsWorkspaceResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('monitor', 'log-analytics', 'workspace', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Parameters valid on both create and update
        this.addSimpleParams(args, config, AzureLogAnalyticsWorkspaceRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureLogAnalyticsWorkspaceRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureLogAnalyticsWorkspaceRender.ARRAY_PARAM_MAP);

        // CREATE_ONLY_SIMPLE_PARAM_MAP is intentionally excluded — --sku is immutable

        // Presence-only flag (no value)
        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }
}
