import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, RenderContext, RING_SHORT_NAME_MAP } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { isResourceNotFoundError, toEnvSlug, execAsync } from '../common/constants.js';

export const AZURE_DNS_ZONE_RESOURCE_TYPE = 'AzureDnsZone';

// refer to: https://learn.microsoft.com/en-us/cli/azure/network/dns/zone

export interface AzureDnsZoneConfig extends ResourceSchema {
    /**
     * DNS subdomain prefix, e.g. "chuangdns".
     * Combined with parentName to form the full DNS zone name passed to Azure CLI:
     *   --name {dnsName}.{parentName}   (e.g. "chuangdns.thebrainly.dev")
     * When parentName is absent, dnsName is used directly as the zone name.
     */
    dnsName: string;
    /** Parent DNS zone name, e.g. "thebrainly.dev" */
    parentName?: string;
    /**
     * Azure region for the resource group (e.g. "eastasia").
     * DNS zones themselves are global, but their resource group requires a location.
     */
    resourceGroupRegion: string;
    /** Tags as key=value pairs */
    tags?: Record<string, string>;
}

export interface AzureDnsZoneResource extends AzureResource<AzureDnsZoneConfig> {}

export class AzureDnsZoneRender extends AzureResourceRender {

    supportConnectorInResourceName: boolean = true;

    /** DNS Zones are global Azure resources — region is irrelevant for lookup. */
    override isGlobalResource = true;

    /**
     * Returns the actual DNS zone name passed to Azure CLI --name.
     * Format: {dnsName}.{parentName}  e.g. "chuangdns.thebrainly.dev"
     * If parentName is not set, returns dnsName as-is.
     */
    getDnsZoneName(resource: AzureDnsZoneResource): string {
        const { dnsName, parentName } = resource.config;
        if (parentName) {
            return `${dnsName}.${parentName}`;
        }
        return dnsName;
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureDnsZoneRender.isAzureDnsZoneResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure DNS Zone resource`);
        }
        // Guard: ensure the parent DNS zone exists before proceeding.
        await this.checkParentDnsZoneExists(resource as AzureDnsZoneResource);

        const ret: Command[] = [];

        // DNS zones are global but their resource group still needs a location.
        // We cannot use ensureResourceGroupCommands() because that requires resource.region.
        // Instead, we generate the RG commands directly using config.location.
        const rgCommands = await this.ensureResourceGroupCommandsForDnsZone(resource as AzureDnsZoneResource, context);
        ret.push(...rgCommands);

        // Get deployed properties to check if DNS zone exists
        const deployedProps = await this.getDeployedProps(resource as AzureDnsZoneResource);

        // If resource doesn't exist, create it; otherwise, update it
        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureDnsZoneResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureDnsZoneResource));
        }

        return ret;
    }

    private static isAzureDnsZoneResource(resource: Resource): resource is AzureDnsZoneResource {
        return resource.type === AZURE_DNS_ZONE_RESOURCE_TYPE;
    }

    /**
     * DNS zones are global but their resource group still requires a location.
     * We cannot use the base ensureResourceGroupCommands() because that passes resource.region
     * to AzureResourceGroupRender which requires region. Instead, we check the RG directly
     * and generate a create command using config.location.
     */
    private async ensureResourceGroupCommandsForDnsZone(resource: AzureDnsZoneResource, _context?: RenderContext): Promise<Command[]> {
        // DNS zones are global resources — their RG is never pre-created in the deployer's
        // Level 0 pass (which only handles regional resources). We must always check/create
        // the RG here regardless of skipResourceGroup.

        const resourceGroupName = this.getResourceGroupName(resource);

        try {
            await execAsync('az', ['group', 'show', '--name', resourceGroupName]);
            // RG already exists — no commands needed
            return [];
        } catch (error: any) {
            if (!isResourceNotFoundError(error)) {
                throw new Error(`Failed to check resource group ${resourceGroupName}: ${error}`);
            }
        }

        // RG does not exist — create it using config.location
        const args: string[] = [
            'group', 'create',
            '--name', resourceGroupName,
            '--location', resource.config.resourceGroupRegion,
        ];
        this.addTags(args, resource.config.tags);

        return [{ command: 'az', args }];
    }

    private async getDeployedProps(resource: AzureDnsZoneResource): Promise<AzureDnsZoneConfig | undefined> {
        const dnsZoneName = this.getDnsZoneName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            // Query by the actual DNS zone name, not the Merlin internal resource name
            const result = await execAsync('az', ['network', 'dns', 'zone', 'show', '-g', resourceGroup, '-n', dnsZoneName]);

            const deployed = JSON.parse(result);

            // Map Azure CLI response to AzureDnsZoneConfig
            const config: Partial<AzureDnsZoneConfig> = {
                tags: deployed.tags,
            };

            // Remove undefined values to keep the config clean
            return Object.fromEntries(
                Object.entries(config).filter(([_, v]) => v !== undefined)
            ) as AzureDnsZoneConfig;

        } catch (error: any) {
            if (isResourceNotFoundError(error)) {
                return undefined;
            }
            throw new Error(
                `Failed to get deployed properties for DNS zone ${dnsZoneName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    /**
     * Verifies that the parent DNS zone exists in Azure before creating a child zone.
     * Skips the check when parentName is not set (root zone).
     * Uses `az network dns zone list` because the parent zone's resource group is unknown.
     * Throws with an actionable message if the parent is missing or the CLI call fails.
     */
    private async checkParentDnsZoneExists(resource: AzureDnsZoneResource): Promise<void> {
        const { parentName } = resource.config;
        if (!parentName) {
            return; // root zone — nothing to check
        }

        let stdout: string;
        try {
            stdout = await execAsync('az', ['network', 'dns', 'zone', 'list']);
        } catch (error: any) {
            const detail = error.stderr?.toString().trim() || error.message || String(error);
            throw new Error(
                `Failed to list DNS zones while checking for parent zone '${parentName}': ${detail}`
            );
        }

        let zones: Array<{ name: string }>;
        try {
            zones = JSON.parse(stdout);
        } catch {
            throw new Error(
                `Failed to parse DNS zone list output while checking for parent zone '${parentName}'. ` +
                `Raw output: ${stdout.slice(0, 200)}`
            );
        }

        const parentNameLower = parentName.toLowerCase();
        const parentExists = zones.some(z => z.name?.toLowerCase() === parentNameLower);

        if (!parentExists) {
            throw new Error(
                `Parent DNS zone '${parentName}' does not exist in Azure.\n` +
                `DNS zones cannot be automatically created by Merlin — you must create it manually:\n` +
                `  az network dns zone create --name ${parentName} --resource-group <your-resource-group>\n` +
                `After creating the parent zone, re-run the deployment.`
            );
        }
    }

    renderCreate(resource: AzureDnsZoneResource): Command[] {
        const config = resource.config;
        const commands: Command[] = [];

        // ── Step 1: Create the DNS zone ───────────────────────────────────────
        const createArgs: string[] = [];
        createArgs.push('network', 'dns', 'zone', 'create');
        createArgs.push('--name', this.getDnsZoneName(resource));
        createArgs.push('--resource-group', this.getResourceGroupName(resource));
        this.addTags(createArgs, config.tags);
        commands.push({ command: 'az', args: createArgs });

        // ── Step 2: NS delegation into parent zone (only when parentName is set) ──
        // After creation, Azure assigns 4 nameservers to the new zone.
        // We query them at deploy time and write NS records into the parent zone
        // so that global DNS resolvers can find the child zone.
        if (config.parentName) {
            commands.push(...this.renderNsDelegation(resource));
        }

        return commands;
    }

    /**
     * Generates commands to delegate the newly created child DNS zone into its
     * parent zone via NS records.
     *
     * Flow:
     *   1. Capture the 4 Azure-assigned nameservers of the child zone into env vars
     *   2. Look up the resource group that owns the parent zone (unknown ahead of time)
     *   3. Create an NS record-set in the parent zone pointing to the child's nameservers
     *
     * All dynamic values are resolved at deploy time via envCapture — no execSync calls.
     */
    private renderNsDelegation(resource: AzureDnsZoneResource): Command[] {
        const { dnsName, parentName } = resource.config;
        if (!parentName) return [];

        const childZoneName = this.getDnsZoneName(resource);
        const childResourceGroup = this.getResourceGroupName(resource);

        // Slug helper: uppercase, non-alphanumeric → underscore (mirrors paramResolver.ts toVarName)
        const zoneSlug = toEnvSlug(childZoneName);

        // Variable names for captured values
        const ns1Var = `MERLIN_${zoneSlug}_NS1`;
        const ns2Var = `MERLIN_${zoneSlug}_NS2`;
        const ns3Var = `MERLIN_${zoneSlug}_NS3`;
        const ns4Var = `MERLIN_${zoneSlug}_NS4`;
        const parentRgVar = `MERLIN_${zoneSlug}_PARENT_RG`;

        const commands: Command[] = [];

        // ── Capture child zone's 4 nameservers ────────────────────────────────
        // az network dns zone show returns nameServers as a JSON array;
        // --query uses JMESPath index expressions to pick each one.
        for (const [varName, index] of [
            [ns1Var, 0], [ns2Var, 1], [ns3Var, 2], [ns4Var, 3],
        ] as [string, number][]) {
            commands.push({
                command: 'az',
                args: [
                    'network', 'dns', 'zone', 'show',
                    '--name', childZoneName,
                    '--resource-group', childResourceGroup,
                    '--query', `nameServers[${index}]`,
                    '--output', 'tsv',
                ],
                envCapture: varName,
            });
        }

        // ── Capture parent zone's resource group ──────────────────────────────
        // The parent zone may live in a different resource group; look it up by name.
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'zone', 'list',
                '--query', `[?name=='${parentName}'].resourceGroup`,
                '--output', 'tsv',
            ],
            envCapture: parentRgVar,
        });

        // ── Write NS record-set into the parent zone ──────────────────────────
        // `dns record-set ns create` is idempotent (overwrites existing record-set).
        // The record-set name is the relative label of the child zone within the parent,
        // e.g. for child "chuang.staging.thebrainly.dev" and parent "thebrainly.dev"
        // the relative label is "chuang.staging".
        const relativeLabel = dnsName; // dnsName is already the part before parentName
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'record-set', 'ns', 'create',
                '--zone-name', parentName,
                '--resource-group', `$${parentRgVar}`,
                '--name', relativeLabel,
                '--ttl', '3600',
            ],
        });

        // Add each captured nameserver as an NS record entry
        for (const nsVar of [ns1Var, ns2Var, ns3Var, ns4Var]) {
            commands.push({
                command: 'az',
                args: [
                    'network', 'dns', 'record-set', 'ns', 'add-record',
                    '--zone-name', parentName,
                    '--resource-group', `$${parentRgVar}`,
                    '--record-set-name', relativeLabel,
                    '--nsdname', `$${nsVar}`,
                ],
            });
        }

        return commands;
    }

    renderUpdate(resource: AzureDnsZoneResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('network', 'dns', 'zone', 'update');

        // --name uses the actual DNS zone name (e.g. "chuangdns.thebrainly.dev")
        args.push('--name', this.getDnsZoneName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Tags can be updated
        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    override getShortResourceTypeName(): string {
        return 'dnsz';
    }

    /**
     * DNS Zones are global resources — no region in resource name.
     * This is the Merlin-internal identifier used for RG naming etc.
     * Format: [project-|shared-]<name>-<ring>-dnsz
     */
    override getResourceName(resource: Resource): string {
        const projectPart = resource.project ? resource.project : 'shared';
        const ringPart = RING_SHORT_NAME_MAP[resource.ring] || resource.ring;
        return [projectPart, resource.name, ringPart, this.getShortResourceTypeName()].filter(Boolean).join('-');
    }

    /**
     * DNS Zones are global resources — no region in resource group name.
     * Format: [project-|shared-]-rg-<ring>
     */
    override getResourceGroupName(resource: Resource): string {
        const projectPart = resource.project ? resource.project : 'shared';
        const ringPart = RING_SHORT_NAME_MAP[resource.ring] || resource.ring;
        return [projectPart, 'rg', ringPart].filter(Boolean).join('-');
    }
}
