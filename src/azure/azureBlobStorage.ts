import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_BLOB_STORAGE_RESOURCE_TYPE = 'AzureBlobStorage';

// refer to: https://learn.microsoft.com/zh-cn/cli/azure/storage/account?view=azure-cli-latest#az-storage-account-create

// Access Tier options
export type AccessTier = 'Cold' | 'Cool' | 'Hot' | 'Premium';

// SKU options
export type StorageSku =
    | 'PremiumV2_LRS' | 'PremiumV2_ZRS' | 'Premium_LRS' | 'Premium_ZRS'
    | 'StandardV2_GRS' | 'StandardV2_GZRS' | 'StandardV2_LRS' | 'StandardV2_ZRS'
    | 'Standard_GRS' | 'Standard_GZRS' | 'Standard_LRS' | 'Standard_RAGRS'
    | 'Standard_RAGZRS' | 'Standard_ZRS';

// Storage account kind
export type StorageAccountKind = 'BlobStorage' | 'BlockBlobStorage' | 'FileStorage' | 'Storage' | 'StorageV2';

// TLS version
export type TlsVersion = 'TLS1_0' | 'TLS1_1' | 'TLS1_2' | 'TLS1_3';

// Public network access
export type PublicNetworkAccess = 'Disabled' | 'Enabled' | 'SecuredByPerimeter';

// Default action for network rules
export type NetworkDefaultAction = 'Allow' | 'Deny';

// Network bypass options
export type NetworkBypass = 'AzureServices' | 'Logging' | 'Metrics' | 'None';

// Encryption key source
export type EncryptionKeySource = 'Microsoft.Keyvault' | 'Microsoft.Storage';

// Encryption services
export type EncryptionService = 'blob' | 'file' | 'queue' | 'table';

// Encryption key type
export type EncryptionKeyType = 'Account' | 'Service';

// Identity type
export type IdentityType = 'None' | 'SystemAssigned' | 'UserAssigned' | 'SystemAssigned,UserAssigned';

// Default share permission
export type DefaultSharePermission =
    | 'None'
    | 'StorageFileDataSmbShareContributor'
    | 'StorageFileDataSmbShareElevatedContributor'
    | 'StorageFileDataSmbShareReader';

// Immutability state
export type ImmutabilityState = 'Disabled' | 'Locked' | 'Unlocked';

// SAS expiration action
export type SasExpirationAction = 'Block' | 'Log';

// Routing choice
export type RoutingChoice = 'InternetRouting' | 'MicrosoftRouting';

// DNS endpoint type
export type DnsEndpointType = 'AzureDnsZone' | 'Standard';

// Zone placement policy
export type ZonePlacementPolicy = 'Any' | 'None';

export interface AzureBlobStorageConfig extends ResourceSchema {

    // Storage account configuration
    accessTier?: AccessTier;
    sku?: StorageSku;
    kind?: StorageAccountKind;
    location?: string;

    // Security and access
    httpsOnly?: boolean;
    minTlsVersion?: TlsVersion;
    allowBlobPublicAccess?: boolean;
    allowSharedKeyAccess?: boolean;
    allowCrossTenantReplication?: boolean;
    publicNetworkAccess?: PublicNetworkAccess;
    defaultAction?: NetworkDefaultAction;

    // Network configuration
    bypass?: NetworkBypass[];
    subnet?: string;
    vnetName?: string;

    // Encryption
    encryptionKeySource?: EncryptionKeySource;
    encryptionServices?: EncryptionService[];
    encryptionKeyName?: string;
    encryptionKeyVault?: string;
    encryptionKeyVersion?: string;
    encryptionKeyTypeForQueue?: EncryptionKeyType;
    encryptionKeyTypeForTable?: EncryptionKeyType;
    requireInfrastructureEncryption?: boolean;
    keyVaultFederatedClientId?: string;
    keyVaultUserIdentityId?: string;

    // Advanced features
    enableHierarchicalNamespace?: boolean; // Data Lake Gen2 (HNS)
    enableNfsV3?: boolean;
    enableSftp?: boolean;
    enableLargeFileShare?: boolean;
    enableLocalUser?: boolean;

    // Identity and access management
    identityType?: IdentityType;
    userIdentityId?: string;
    assignIdentity?: string;

    // Azure Files integration
    enableFilesAadds?: boolean; // Azure AD Domain Services
    enableFilesAadKerb?: boolean; // Azure AD Kerberos
    enableFilesAdds?: boolean; // Active Directory Domain Services
    enableSmbOauth?: boolean;
    defaultSharePermission?: DefaultSharePermission;

    // Active Directory configuration
    domainName?: string;
    domainGuid?: string;
    domainSid?: string;
    azureStorageSid?: string;
    forestName?: string;
    netBiosDomainName?: string;
    samAccountName?: string;
    accountType?: string;

    // Data protection and compliance
    enableAlw?: boolean; // Advanced Threat Protection
    immutabilityPeriodInDays?: number;
    immutabilityState?: ImmutabilityState;
    allowProtectedAppendWrites?: boolean;
    allowAppend?: boolean;

    // Key and SAS expiration policies
    keyExpirationPeriodInDays?: number;
    sasExpirationPeriod?: string;
    sasExpirationAction?: SasExpirationAction;

    // Routing and endpoints
    routingChoice?: RoutingChoice;
    publishInternetEndpoints?: boolean;
    publishMicrosoftEndpoints?: boolean;
    publishIpv6Endpoint?: boolean;
    dnsEndpointType?: DnsEndpointType;

    // Blob geo-replication
    enableBlobGeoPriorityReplication?: boolean;

    // Other
    customDomain?: string;
    tags?: Record<string, string>;
    edgeZone?: string;
    zones?: string[];
    zonePlacementPolicy?: ZonePlacementPolicy;
}

export interface AzureBlobStorageResource extends AzureResource<AzureBlobStorageConfig> {

}

export class AzureBlobStorageRender extends AzureResourceRender {
    
    supportConnectorInResourceName: boolean = false;

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureBlobStorageRender.isAzureBlobStorageResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure Blob Storage resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        // Get deployed properties to check if storage account exists
        const deployedProps = await this.getDeployedProps(resource);

        // If resource doesn't exist, create it; otherwise, update it
        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureBlobStorageResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureBlobStorageResource));
        }

        return ret;
    }

    private static isAzureBlobStorageResource(resource: Resource): resource is AzureBlobStorageResource {
        return resource.type === AZURE_BLOB_STORAGE_RESOURCE_TYPE;
    }

    private async getDeployedProps(resource: Resource): Promise<AzureBlobStorageConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            // Execute az storage account show command
            const result = execSync(
                `az storage account show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const deployedProps = JSON.parse(result);

            // Map Azure CLI response to AzureBlobStorageConfig
            const config: AzureBlobStorageConfig = {
                // Storage account configuration
                accessTier: deployedProps.accessTier as AccessTier,
                sku: deployedProps.sku?.name as StorageSku,
                kind: deployedProps.kind as StorageAccountKind,
                location: deployedProps.location,

                // Security and access
                httpsOnly: deployedProps.enableHttpsTrafficOnly,
                minTlsVersion: deployedProps.minimumTlsVersion as TlsVersion,
                allowBlobPublicAccess: deployedProps.allowBlobPublicAccess,
                allowSharedKeyAccess: deployedProps.allowSharedKeyAccess,
                allowCrossTenantReplication: deployedProps.allowCrossTenantReplication,
                publicNetworkAccess: deployedProps.publicNetworkAccess as PublicNetworkAccess,
                defaultAction: deployedProps.networkRuleSet?.defaultAction as NetworkDefaultAction,

                // Network configuration
                bypass: deployedProps.networkRuleSet?.bypass ?
                    deployedProps.networkRuleSet.bypass.split(',').map((s: string) => s.trim()) as NetworkBypass[] :
                    undefined,

                // Encryption
                encryptionKeySource: deployedProps.encryption?.keySource as EncryptionKeySource,
                requireInfrastructureEncryption: deployedProps.encryption?.requireInfrastructureEncryption,

                // Advanced features
                enableHierarchicalNamespace: deployedProps.isHnsEnabled,
                enableNfsV3: deployedProps.enableNfsV3,
                enableSftp: deployedProps.isSftpEnabled,
                enableLargeFileShare: deployedProps.largeFileSharesState === 'Enabled',
                enableLocalUser: deployedProps.isLocalUserEnabled,

                // Identity
                identityType: deployedProps.identity?.type as IdentityType,

                // Tags
                tags: deployedProps.tags,

                // Zones
                zones: deployedProps.zones,

                // DNS endpoint type
                dnsEndpointType: deployedProps.dnsEndpointType as DnsEndpointType,

                // Custom domain
                customDomain: deployedProps.customDomain?.name,

                // Routing preference
                routingChoice: deployedProps.routingPreference?.routingChoice as RoutingChoice,
                publishInternetEndpoints: deployedProps.routingPreference?.publishInternetEndpoints,
                publishMicrosoftEndpoints: deployedProps.routingPreference?.publishMicrosoftEndpoints,

                // Dual stack endpoint preference
                publishIpv6Endpoint: deployedProps.dualStackEndpointPreference?.publishIpv6Endpoint,

                // SAS policy
                sasExpirationPeriod: deployedProps.sasPolicy?.sasExpirationPeriod,
                sasExpirationAction: deployedProps.sasPolicy?.sasExpirationAction as SasExpirationAction,

                // Key policy
                keyExpirationPeriodInDays: deployedProps.keyPolicy?.keyExpirationPeriodInDays,

                // Immutable storage
                immutabilityPeriodInDays: deployedProps.immutableStorageWithVersioning?.immutabilityPolicy?.immutabilityPeriodSinceCreationInDays,
                immutabilityState: deployedProps.immutableStorageWithVersioning?.immutabilityPolicy?.state as ImmutabilityState,
                allowProtectedAppendWrites: deployedProps.immutableStorageWithVersioning?.immutabilityPolicy?.allowProtectedAppendWrites,

                // Azure Files identity-based authentication
                enableFilesAadds: deployedProps.azureFilesIdentityBasedAuthentication?.directoryServiceOptions === 'AADDS',
                enableFilesAadKerb: deployedProps.azureFilesIdentityBasedAuthentication?.directoryServiceOptions === 'AADKERB',
                enableFilesAdds: deployedProps.azureFilesIdentityBasedAuthentication?.directoryServiceOptions === 'AD',
                defaultSharePermission: deployedProps.azureFilesIdentityBasedAuthentication?.defaultSharePermission as DefaultSharePermission,

                // Active Directory configuration
                domainName: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.domainName,
                domainGuid: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.domainGuid,
                domainSid: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.domainSid,
                azureStorageSid: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.azureStorageSid,
                forestName: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.forestName,
                netBiosDomainName: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.netBiosDomainName,
                samAccountName: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.samAccountName,
                accountType: deployedProps.azureFilesIdentityBasedAuthentication?.activeDirectoryProperties?.accountType,
            };

            // Remove undefined values to keep the config clean
            return Object.fromEntries(
                Object.entries(config).filter(([_, v]) => v !== undefined)
            ) as AzureBlobStorageConfig;

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
                `Failed to get deployed properties for storage account ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    /**
     * Configuration mapping for simple key-value parameters
     * Maps config property names to their corresponding CLI flags
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'accessTier': '--access-tier',
        'sku': '--sku',
        'kind': '--kind',
        'location': '--location',
        'minTlsVersion': '--min-tls-version',
        'publicNetworkAccess': '--public-network-access',
        'defaultAction': '--default-action',
        'encryptionKeySource': '--encryption-key-source',
        'encryptionKeyName': '--encryption-key-name',
        'encryptionKeyVault': '--encryption-key-vault',
        'encryptionKeyVersion': '--encryption-key-version',
        'encryptionKeyTypeForQueue': '--encryption-key-type-for-queue',
        'encryptionKeyTypeForTable': '--encryption-key-type-for-table',
        'identityType': '--identity-type',
        'userIdentityId': '--user-identity-id',
        'assignIdentity': '--assign-identity',
        'defaultSharePermission': '--default-share-permission',
        'domainName': '--domain-name',
        'domainGuid': '--domain-guid',
        'domainSid': '--domain-sid',
        'azureStorageSid': '--azure-storage-sid',
        'forestName': '--forest-name',
        'netBiosDomainName': '--netbios-domain-name',
        'samAccountName': '--sam-account-name',
        'accountType': '--account-type',
        'immutabilityPeriodInDays': '--immutability-period',
        'immutabilityState': '--immutability-state',
        'keyExpirationPeriodInDays': '--key-expiration-period-in-days',
        'sasExpirationPeriod': '--sas-expiration-period',
        'sasExpirationAction': '--sas-policy',
        'routingChoice': '--routing-choice',
        'dnsEndpointType': '--dns-endpoint-type',
        'customDomain': '--custom-domain',
        'edgeZone': '--edge-zone',
        'zonePlacementPolicy': '--zone-placement-policy',
        'keyVaultFederatedClientId': '--key-vault-federated-client-id',
        'keyVaultUserIdentityId': '--key-vault-user-assigned-identity-id',
        'subnet': '--subnet',
        'vnetName': '--vnet-name',
    };

    /**
     * Configuration mapping for boolean flags
     * Maps config property names to their corresponding CLI flags
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'httpsOnly': '--https-only',
        'allowBlobPublicAccess': '--allow-blob-public-access',
        'allowSharedKeyAccess': '--allow-shared-key-access',
        'allowCrossTenantReplication': '--allow-cross-tenant-replication',
        'enableHierarchicalNamespace': '--enable-hierarchical-namespace',
        'enableNfsV3': '--enable-nfs-v3',
        'enableSftp': '--enable-sftp',
        'enableLargeFileShare': '--enable-large-file-share',
        'enableLocalUser': '--enable-local-user',
        'enableFilesAadds': '--enable-files-aadds',
        'enableFilesAadKerb': '--enable-files-aad-kerb',
        'enableFilesAdds': '--enable-files-adds',
        'enableSmbOauth': '--enable-smb-oauth',
        'enableAlw': '--enable-alw',
        'allowProtectedAppendWrites': '--allow-protected-append-writes',
        'allowAppend': '--allow-append',
        'publishInternetEndpoints': '--publish-internet-endpoints',
        'publishMicrosoftEndpoints': '--publish-microsoft-endpoints',
        'publishIpv6Endpoint': '--publish-ipv6-endpoint',
        'enableBlobGeoPriorityReplication': '--enable-blob-geo-priority-replication',
        'requireInfrastructureEncryption': '--require-infrastructure-encryption',
    };

    /**
     * Configuration mapping for array parameters
     * Maps config property names to their corresponding CLI flags
     */
    private static readonly ARRAY_PARAM_MAP: Record<string, string> = {
        'bypass': '--bypass',
        'encryptionServices': '--encryption-services',
        'zones': '--zones',
    };

    renderCreate(resource: AzureBlobStorageResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('storage', 'account', 'create');

        // Required parameters
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Add all optional parameters using helper methods
        this.addSimpleParams(args, config, AzureBlobStorageRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureBlobStorageRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureBlobStorageRender.ARRAY_PARAM_MAP);
        this.addTags(args, config.tags);

        return [{
            command: 'az',
            args: args
        }];
    }

    renderUpdate(resource: AzureBlobStorageResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        // Base command
        args.push('storage', 'account', 'update');

        // Required parameters
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Add all optional parameters using helper methods
        this.addSimpleParams(args, config, AzureBlobStorageRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureBlobStorageRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureBlobStorageRender.ARRAY_PARAM_MAP);
        this.addTags(args, config.tags);

        return [{
            command: 'az',
            args: args
        }];
    }

    override getShortResourceTypeName(): string {
        return 'abs';
    }
}
