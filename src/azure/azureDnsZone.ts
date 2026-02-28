import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, RING_SHORT_NAME_MAP } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

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

    async renderImpl(resource: Resource): Promise<Command[]> {
        if (!AzureDnsZoneRender.isAzureDnsZoneResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure DNS Zone resource`);
        }
        console.log(`Rendering Azure DNS Zone resource ${resource.name} in ring ${resource.ring} with config:`, resource.config);
        // Guard: ensure the parent DNS zone exists before proceeding.
        await this.checkParentDnsZoneExists(resource as AzureDnsZoneResource);

        const ret: Command[] = [];

        // DNS zones are global but their resource group still needs a location.
        // We cannot use ensureResourceGroupCommands() because that requires resource.region.
        // Instead, we generate the RG commands directly using config.location.
        const rgCommands = await this.ensureResourceGroupCommandsForDnsZone(resource as AzureDnsZoneResource);
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
    private async ensureResourceGroupCommandsForDnsZone(resource: AzureDnsZoneResource): Promise<Command[]> {
        const resourceGroupName = this.getResourceGroupName(resource);

        try {
            execSync(`az group show --name ${resourceGroupName} 2>/dev/null`, { encoding: 'utf-8' });
            // RG already exists — no commands needed
            return [];
        } catch (error: any) {
            const notFound =
                error.status === 3 ||
                error.status === 1 ||
                (error.message + ' ' + (error.stderr?.toString() || '')).includes('ResourceGroupNotFound') ||
                (error.message + ' ' + (error.stderr?.toString() || '')).includes('was not found') ||
                (error.message + ' ' + (error.stderr?.toString() || '')).includes('could not be found');

            if (!notFound) {
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
            const result = execSync(
                `az network dns zone show -g ${resourceGroup} -n ${dnsZoneName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

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
            // If the command failed, it likely means the resource doesn't exist
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
            stdout = execSync('az network dns zone list', { encoding: 'utf-8' });
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
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('network', 'dns', 'zone', 'create');

        // --name uses the actual DNS zone name (e.g. "chuangdns.thebrainly.dev")
        args.push('--name', this.getDnsZoneName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
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
