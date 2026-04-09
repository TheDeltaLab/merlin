import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { isResourceNotFoundError, execAsync, toEnvSlug } from '../common/constants.js';

export const AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE = 'AzureRedisEnterprise';

// refer to: https://learn.microsoft.com/en-us/cli/azure/redisenterprise?view=azure-cli-latest

export interface RedisAccessPolicyAssignment {
    /** Object ID of the AAD principal, or a ${ } expression that resolves at deploy time */
    objectId: string;
}

export interface AzureRedisEnterpriseConfig extends ResourceSchema {
    /** Redis Enterprise SKU (e.g. Balanced_B1, Enterprise_E10) */
    sku?: string;
    /** Azure region */
    location?: string;
    /** Cluster capacity (not supported for Balanced_* SKUs) */
    capacity?: number;
    /** Availability zones */
    zones?: string[];
    /** Minimum TLS version (e.g. '1.2') */
    minimumTlsVersion?: string;
    /** Access keys authentication: 'Enabled' | 'Disabled' */
    accessKeysAuth?: string;
    /** Public network access: 'Enabled' | 'Disabled' */
    publicNetworkAccess?: string;
    // ── Inline database params (auto-created with cluster) ──────────────────
    /** Client protocol: 'Encrypted' | 'Plaintext' */
    clientProtocol?: string;
    /** Clustering policy: 'EnterpriseCluster' | 'OSSCluster' | 'NoCluster' */
    clusteringPolicy?: string;
    /** Eviction policy: 'NoEviction' | 'AllKeysLRU' | etc. */
    evictionPolicy?: string;
    /** Database port (default 10000) */
    port?: number;
    /** High availability: 'Enabled' | 'Disabled' */
    highAvailability?: string;
    /**
     * Entra ID access policy assignments for the default database.
     * Each entry grants an AAD principal (SP, MI, user) data-plane access via Entra ID auth.
     * Required when accessKeysAuth is 'Disabled'.
     */
    accessPolicyAssignments?: RedisAccessPolicyAssignment[];
    /** Tags */
    tags?: Record<string, string>;
}

export interface AzureRedisEnterpriseResource extends Resource<AzureRedisEnterpriseConfig> {}

/**
 * Azure Redis Enterprise Render.
 *
 * On create:
 *   1. Ensure resource group
 *   2. az redisenterprise create ... (auto-creates default database with inline params)
 *
 * On update:
 *   1. az redisenterprise update ... (limited: tags, zones, identity)
 *
 * Redis Enterprise cluster names: alphanumeric and hyphens, 11–40 characters.
 */
export class AzureRedisEnterpriseRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = false;

    override getShortResourceTypeName(): string {
        return 'redis';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureRedisEnterpriseRender.isRedisEnterpriseResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an AzureRedisEnterprise resource`);
        }

        const ret: Command[] = [];

        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureRedisEnterpriseResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureRedisEnterpriseResource));
        }

        // Access policy assignments (Entra ID data-plane auth)
        ret.push(...this.renderAccessPolicyAssignments(resource as AzureRedisEnterpriseResource));

        return ret;
    }

    private static isRedisEnterpriseResource(resource: Resource): resource is AzureRedisEnterpriseResource {
        return resource.type === AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzureRedisEnterpriseConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = await execAsync('az', ['redisenterprise', 'show', '-g', resourceGroup, '-n', resourceName]);

            const d = JSON.parse(result);

            const config: AzureRedisEnterpriseConfig = {
                sku: d.sku?.name,
                location: d.location,
                minimumTlsVersion: d.minimumTlsVersion,
                tags: d.tags,
            };

            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzureRedisEnterpriseConfig;

        } catch (error: any) {
            if (isResourceNotFoundError(error)) {
                return undefined;
            }
            throw new Error(
                `Failed to get deployed properties for Redis Enterprise ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'sku': '--sku',
        'minimumTlsVersion': '--minimum-tls-version',
    };

    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'location': '--location',
        'accessKeysAuth': '--access-keys-auth',
        'publicNetworkAccess': '--public-network-access',
        // Inline database params (only on create)
        'clientProtocol': '--client-protocol',
        'clusteringPolicy': '--clustering-policy',
        'evictionPolicy': '--eviction-policy',
        'highAvailability': '--high-availability',
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzureRedisEnterpriseResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('redisenterprise', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzureRedisEnterpriseRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzureRedisEnterpriseRender.CREATE_ONLY_SIMPLE_PARAM_MAP);

        // Capacity (not supported for Balanced_* SKUs)
        if (config.capacity !== undefined) {
            args.push('--capacity', String(config.capacity));
        }

        // Port (inline database param)
        if (config.port !== undefined) {
            args.push('--port', String(config.port));
        }

        // Zones
        if (config.zones && config.zones.length > 0) {
            args.push('--zones', ...config.zones);
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzureRedisEnterpriseResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('redisenterprise', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Update is very limited — mostly tags and zones
        this.addTags(args, config.tags);

        if (config.zones && config.zones.length > 0) {
            args.push('--zones', ...config.zones);
        }

        return [{ command: 'az', args }];
    }

    // ── Access policy assignments (Entra ID data-plane auth) ─────────────────

    /**
     * Render access policy assignment commands for the default database.
     *
     * When accessKeysAuth is 'Disabled', each AAD principal that needs data-plane
     * access must have an explicit access policy assignment on the database.
     *
     * Uses `bash -c '... || true'` for idempotency — "already exists" errors
     * are swallowed on re-runs.
     *
     * The objectId may be:
     * - A literal UUID (e.g. user/group Object ID)
     * - A shell variable reference (e.g. $MERLIN_SP_..._OID) from a ${ } expression
     *   that was resolved by the deployer at render time
     */
    renderAccessPolicyAssignments(resource: AzureRedisEnterpriseResource): Command[] {
        const config = resource.config;
        if (!config.accessPolicyAssignments || config.accessPolicyAssignments.length === 0) {
            return [];
        }

        const clusterName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);
        const envSlug = toEnvSlug(`REDIS_${resource.name}_${resource.ring}`);

        const commands: Command[] = [];

        for (const assignment of config.accessPolicyAssignments) {
            const objectId = assignment.objectId;

            // Capture objectId into a variable if it's a shell variable reference,
            // so we can use it as both --name and --object-id
            const varName = `MERLIN_${envSlug}_REDIS_USER_OID`;

            // Use bash -c for idempotency: swallow "already exists" errors
            // --access-policy-assignment-name must match ^[A-Za-z0-9]{1,60}$,
            // so we strip hyphens from the Object ID UUID to use as the name.
            const nameVar = `${varName}_NAME`;
            commands.push({
                command: 'bash',
                args: [
                    '-c',
                    `${varName}="${objectId}" && ` +
                    `${nameVar}=$(echo $${varName} | tr -d '-') && ` +
                    `az redisenterprise database access-policy-assignment create ` +
                    `--cluster-name ${clusterName} ` +
                    `--resource-group ${resourceGroup} ` +
                    `--database-name default ` +
                    `--access-policy-assignment-name $${nameVar} ` +
                    `--access-policy-name default ` +
                    `--object-id $${varName} ` +
                    `|| true`
                ]
            });
        }

        return commands;
    }
}
