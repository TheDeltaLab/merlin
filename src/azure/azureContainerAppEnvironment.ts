import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_CONTAINER_APP_ENVIRONMENT_TYPE = 'AzureContainerAppEnvironment';

// refer to: https://learn.microsoft.com/en-us/cli/azure/containerapp/env?view=azure-cli-latest#az-containerapp-env-create

// Logs destination options
export type LogsDestination = 'azure-monitor' | 'log-analytics' | 'none';

export interface AzureContainerAppEnvironmentConfig extends ResourceSchema {
    // ── Networking — CREATE ONLY ──────────────────────────────────────────────
    infrastructureSubnetResourceId?: string; // --infrastructure-subnet-resource-id
    infrastructureResourceGroup?: string;    // --infrastructure-resource-group
    platformReservedCidr?: string;           // --platform-reserved-cidr
    platformReservedDnsIp?: string;          // --platform-reserved-dns-ip
    internalOnly?: boolean;                  // --internal-only {false, true}

    // ── Logging ───────────────────────────────────────────────────────────────
    logsDestination?: LogsDestination;       // --logs-destination {azure-monitor, log-analytics, none}
    logsWorkspaceId?: string;                // --logs-workspace-id
    logsWorkspaceKey?: string;               // --logs-workspace-key (write-only, not returned by show)

    // ── Custom domain — CREATE ONLY ───────────────────────────────────────────
    customDomainCertificateFile?: string;    // --certificate-file / --custom-domain-certificate-file
    customDomainCertificatePassword?: string; // --certificate-password / --custom-domain-certificate-password (write-only)
    customDomainDnsSuffix?: string;          // --custom-domain-dns-suffix / --dns-suffix

    // ── Peer authentication & traffic ─────────────────────────────────────────
    enableMtls?: boolean;                    // --enable-mtls {false, true}
    enablePeerToPeerEncryption?: boolean;    // --enable-peer-to-peer-encryption {false, true}

    // ── Workload profiles — CREATE ONLY ───────────────────────────────────────
    enableWorkloadProfiles?: boolean;        // --enable-workload-profiles {false, true}

    // ── Misc ──────────────────────────────────────────────────────────────────
    daprConnectionString?: string;           // --dapr-connection-string
    storageAccount?: string;                 // --storage-account
    location?: string;                       // --location
    /**
     * --zone-redundant is CREATE ONLY
     */
    zoneRedundant?: boolean;                 // --zone-redundant
    /**
     * --no-wait is a presence-only flag (no value).
     * When true, '--no-wait' is appended without a following 'true'/'false' value.
     */
    noWait?: boolean;
    tags?: Record<string, string>;           // --tags
}

export interface AzureContainerAppEnvironmentResource extends AzureResource<AzureContainerAppEnvironmentConfig> {}

export class AzureContainerAppEnvironmentRender extends AzureResourceRender {

    /** Container app environment names support hyphens */
    supportConnectorInResourceName: boolean = true;

    override getShortResourceTypeName(): string {
        return 'acenv';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureContainerAppEnvironmentRender.isAzureContainerAppEnvironmentResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure Container App Environment resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        // Check if container app environment already exists
        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureContainerAppEnvironmentResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureContainerAppEnvironmentResource));
        }

        return ret;
    }

    private static isAzureContainerAppEnvironmentResource(resource: Resource): resource is AzureContainerAppEnvironmentResource {
        return resource.type === AZURE_CONTAINER_APP_ENVIRONMENT_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzureContainerAppEnvironmentConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = execSync(
                `az containerapp env show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const d = JSON.parse(result);

            // Convenience accessors
            const vnetConfig = d.properties?.vnetConfiguration;
            const appLogsConfig = d.properties?.appLogsConfiguration;
            const peerAuth = d.properties?.peerAuthentication;
            const peerTraffic = d.properties?.peerTrafficConfiguration;

            const config: AzureContainerAppEnvironmentConfig = {
                // Logging
                logsDestination: appLogsConfig?.destination as LogsDestination,
                logsWorkspaceId: appLogsConfig?.logAnalyticsConfiguration?.customerId,
                // logsWorkspaceKey is write-only — not returned by show

                // Networking (create-only, kept for state detection)
                infrastructureSubnetResourceId: vnetConfig?.infrastructureSubnetId,
                internalOnly: vnetConfig?.internal,
                platformReservedCidr: vnetConfig?.platformReservedCidr,
                platformReservedDnsIp: vnetConfig?.platformReservedDnsIP,
                // infrastructureResourceGroup not in standard show response

                // Custom domain (write-only — not returned by show)

                // Peer authentication & traffic
                enableMtls: peerAuth?.mtls?.enabled,
                enablePeerToPeerEncryption: peerTraffic?.encryption?.enabled,

                // Misc
                zoneRedundant: d.properties?.zoneRedundant,
                tags: d.tags,

                // enableWorkloadProfiles: create-only, not in show response
                // daprConnectionString: not in standard show response
                // storageAccount: not in standard show response
                // customDomain*: write-only
                // logsWorkspaceKey: write-only
                // customDomainCertificatePassword: write-only
            };

            // Remove undefined values
            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzureContainerAppEnvironmentConfig;

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
                `Failed to get deployed properties for container app environment ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    /**
     * Simple key-value params supported on BOTH create and update
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'logsDestination': '--logs-destination',
        'logsWorkspaceId': '--logs-workspace-id',
        'logsWorkspaceKey': '--logs-workspace-key',
        'daprConnectionString': '--dapr-connection-string',
        'storageAccount': '--storage-account',
        'location': '--location',
    };

    /**
     * Simple key-value params supported on CREATE only
     */
    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'infrastructureSubnetResourceId': '--infrastructure-subnet-resource-id',
        'infrastructureResourceGroup': '--infrastructure-resource-group',
        'platformReservedCidr': '--platform-reserved-cidr',
        'platformReservedDnsIp': '--platform-reserved-dns-ip',
        'customDomainCertificateFile': '--certificate-file',
        'customDomainCertificatePassword': '--certificate-password',
        'customDomainDnsSuffix': '--custom-domain-dns-suffix',
    };

    /**
     * Boolean flags (emit --flag true/false) supported on BOTH create and update
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableMtls': '--enable-mtls',
        'enablePeerToPeerEncryption': '--enable-peer-to-peer-encryption',
    };

    /**
     * Boolean flags (emit --flag true/false) supported on CREATE only
     */
    private static readonly CREATE_ONLY_BOOLEAN_FLAG_MAP: Record<string, string> = {
        'internalOnly': '--internal-only',
        'enableWorkloadProfiles': '--enable-workload-profiles',
        'zoneRedundant': '--zone-redundant',
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzureContainerAppEnvironmentResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('containerapp', 'env', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzureContainerAppEnvironmentRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzureContainerAppEnvironmentRender.CREATE_ONLY_SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppEnvironmentRender.BOOLEAN_FLAG_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppEnvironmentRender.CREATE_ONLY_BOOLEAN_FLAG_MAP);

        // --no-wait is a presence-only flag (no value argument)
        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzureContainerAppEnvironmentResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('containerapp', 'env', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // CREATE_ONLY_* maps are intentionally excluded here
        this.addSimpleParams(args, config, AzureContainerAppEnvironmentRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppEnvironmentRender.BOOLEAN_FLAG_MAP);

        // Azure CLI requires --logs-destination log-analytics when --logs-workspace-id/key are provided on update
        if (config.logsWorkspaceId && !config.logsDestination) {
            args.push('--logs-destination', 'log-analytics');
        }

        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }
}
