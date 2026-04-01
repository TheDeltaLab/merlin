/**
 * Azure cloud provider registration.
 *
 * Consolidates ALL Azure-specific registrations into one function:
 *   - Renders (cloud-agnostic + Azure-specific type names)
 *   - Auth providers
 *   - Property getters
 *   - Pre-deploy provider
 *
 * Called from init.ts when MERLIN_CLOUD === 'azure'.
 */

import { registerRender, registerAuthProvider, registerPropertyGetter, registerPreDeployProvider } from '../common/resource.js';

// ── Cloud-agnostic type constants ────────────────────────────────────────────
import {
    CONTAINER_APP_TYPE,
    CONTAINER_REGISTRY_TYPE,
    CONTAINER_APP_ENVIRONMENT_TYPE,
    OBJECT_STORAGE_TYPE,
    LOG_SINK_TYPE,
    DNS_ZONE_TYPE,
    SERVICE_PRINCIPAL_TYPE,
    APP_REGISTRATION_TYPE,
    KUBERNETES_CLUSTER_TYPE,
} from '../common/cloudTypes.js';

// ── Azure renders ────────────────────────────────────────────────────────────
import { AZURE_BLOB_STORAGE_RESOURCE_TYPE, AzureBlobStorageRender } from './azureBlobStorage.js';
import { AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE, AzureContainerRegistryRender } from './azureContainerRegistry.js';
import { AZURE_RESOURCE_GROUP, AzureResourceGroupRender } from './resourceGroup.js';
import { AZURE_CONTAINER_APP_TYPE, AzureContainerAppRender } from './azureContainerApp.js';
import { AZURE_AD_APP_RESOURCE_TYPE, AzureADAppRender } from './azureADApp.js';
import { AZURE_DNS_ZONE_RESOURCE_TYPE, AzureDnsZoneRender } from './azureDnsZone.js';
import { AZURE_CONTAINER_APP_ENVIRONMENT_TYPE, AzureContainerAppEnvironmentRender } from './azureContainerAppEnvironment.js';
import { AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE, AzureLogAnalyticsWorkspaceRender } from './azureLogAnalyticsWorkspace.js';
import { AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE, AzureServicePrincipalRender } from './azureServicePrincipal.js';
import { AZURE_KEY_VAULT_RESOURCE_TYPE, AzureKeyVaultRender } from './azureKeyVault.js';
import { AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE, AzureRedisEnterpriseRender } from './azureRedisEnterprise.js';
import { AZURE_POSTGRESQL_RESOURCE_TYPE, AzurePostgreSQLFlexibleRender } from './azurePostgreSQLFlexible.js';
import { AZURE_FUNCTION_APP_RESOURCE_TYPE, AzureFunctionAppRender } from './azureFunctionApp.js';
import { AZURE_AKS_TYPE, AzureAKSRender } from '../kubernetes/kubernetesCluster.js';

// ── Azure auth providers ─────────────────────────────────────────────────────
import { AzureEntraIDAuthProvider, AzureManagedIdentityAuthProvider } from './authProvider.js';

// ── Azure property getters ───────────────────────────────────────────────────
import {
    AzureResourceManagedIdentityGetter,
    AzureResourceNameGetter,
    AzureContainerRegistryServerGetter,
    AzureContainerAppFqdnGetter,
    AzureLogAnalyticsWorkspaceCustomerIdGetter,
    AzureLogAnalyticsWorkspaceSharedKeyGetter,
    AzureDnsZoneNameGetter,
    AzureADAppClientIdGetter,
    AzureKeyVaultUrlGetter,
    AzureServicePrincipalClientIdGetter,
    AzureRedisEnterpriseUrlGetter,
    AzureResourceApiScopeGetter,
    AzureAKSOidcIssuerUrlGetter,
} from './propertyGetter.js';

// ── Azure pre-deploy provider ────────────────────────────────────────────────
import { AzurePreDeployProvider } from './preDeployProvider.js';

/**
 * Registers all Azure cloud provider implementations:
 * - Renders (both cloud-agnostic and Azure-specific type names)
 * - Auth providers
 * - Property getters
 * - Pre-deploy provider
 */
export function registerAzureProviders(): void {
    // ── Cloud-agnostic type names → Azure implementations ────────────────
    registerRender(CONTAINER_APP_TYPE,             new AzureContainerAppRender());
    registerRender(CONTAINER_REGISTRY_TYPE,        new AzureContainerRegistryRender());
    registerRender(CONTAINER_APP_ENVIRONMENT_TYPE, new AzureContainerAppEnvironmentRender());
    registerRender(OBJECT_STORAGE_TYPE,            new AzureBlobStorageRender());
    registerRender(LOG_SINK_TYPE,                  new AzureLogAnalyticsWorkspaceRender());
    registerRender(DNS_ZONE_TYPE,                  new AzureDnsZoneRender());
    registerRender(SERVICE_PRINCIPAL_TYPE,         new AzureServicePrincipalRender());
    registerRender(APP_REGISTRATION_TYPE,          new AzureADAppRender());
    registerRender(KUBERNETES_CLUSTER_TYPE,        new AzureAKSRender());

    // ── Azure-specific type names (backwards compatibility) ──────────────
    registerRender(AZURE_BLOB_STORAGE_RESOURCE_TYPE,            new AzureBlobStorageRender());
    registerRender(AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE,      new AzureContainerRegistryRender());
    registerRender(AZURE_RESOURCE_GROUP,                        new AzureResourceGroupRender());
    registerRender(AZURE_CONTAINER_APP_TYPE,                    new AzureContainerAppRender());
    registerRender(AZURE_AD_APP_RESOURCE_TYPE,                  new AzureADAppRender());
    registerRender(AZURE_DNS_ZONE_RESOURCE_TYPE,                new AzureDnsZoneRender());
    registerRender(AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE, new AzureLogAnalyticsWorkspaceRender());
    registerRender(AZURE_CONTAINER_APP_ENVIRONMENT_TYPE,        new AzureContainerAppEnvironmentRender());
    registerRender(AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,       new AzureServicePrincipalRender());
    registerRender(AZURE_KEY_VAULT_RESOURCE_TYPE,               new AzureKeyVaultRender());
    registerRender(AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE,        new AzureRedisEnterpriseRender());
    registerRender(AZURE_POSTGRESQL_RESOURCE_TYPE,              new AzurePostgreSQLFlexibleRender());
    registerRender(AZURE_FUNCTION_APP_RESOURCE_TYPE,            new AzureFunctionAppRender());
    registerRender(AZURE_AKS_TYPE,                              new AzureAKSRender());

    // ── Auth providers ───────────────────────────────────────────────────
    registerAuthProvider(new AzureManagedIdentityAuthProvider());
    registerAuthProvider(new AzureEntraIDAuthProvider());

    // ── Property getters ─────────────────────────────────────────────────
    registerPropertyGetter(new AzureResourceManagedIdentityGetter());
    registerPropertyGetter(new AzureResourceNameGetter());
    registerPropertyGetter(new AzureContainerRegistryServerGetter());
    registerPropertyGetter(new AzureContainerAppFqdnGetter());
    registerPropertyGetter(new AzureLogAnalyticsWorkspaceCustomerIdGetter());
    registerPropertyGetter(new AzureLogAnalyticsWorkspaceSharedKeyGetter());
    registerPropertyGetter(new AzureDnsZoneNameGetter());
    registerPropertyGetter(new AzureADAppClientIdGetter());
    registerPropertyGetter(new AzureKeyVaultUrlGetter());
    registerPropertyGetter(new AzureServicePrincipalClientIdGetter());
    registerPropertyGetter(new AzureRedisEnterpriseUrlGetter());
    registerPropertyGetter(new AzureResourceApiScopeGetter());
    registerPropertyGetter(new AzureAKSOidcIssuerUrlGetter());

    // ── Pre-deploy provider ──────────────────────────────────────────────
    registerPreDeployProvider(new AzurePreDeployProvider());
}
