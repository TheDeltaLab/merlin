/**
 * Initialization module - registers all providers
 * This should be imported before any generated resources
 */

import { registerAuthProvider, registerProprietyGetter, registerRender } from './common/resource.js';
import { AzureEntraIDAuthProvider, AzureManagedIdentityAuthProvider } from './azure/authProvider.js';
import {
    AZURE_BLOB_STORAGE_RESOURCE_TYPE,
    AzureBlobStorageRender
} from './azure/azureBlobStorage.js';
import {
    AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE,
    AzureContainerRegistryRender
} from './azure/azureContainerRegistry.js';
import {
    AZURE_RESOURCE_GROUP,
    AzureResourceGroupRender
} from './azure/resourceGroup.js';
import {
    AZURE_CONTAINER_APP_TYPE,
    AzureContainerAppRender
} from './azure/azureContainerApp.js';
import {
    AZURE_AD_APP_RESOURCE_TYPE,
    AzureADAppRender
} from './azure/azureADApp.js';
import {
    AZURE_DNS_ZONE_RESOURCE_TYPE,
    AzureDnsZoneRender
} from './azure/azureDnsZone.js';
import {
    AZURE_CONTAINER_APP_ENVIRONMENT_TYPE,
    AzureContainerAppEnvironmentRender
} from './azure/azureContainerAppEnvironment.js';
import {
    AzureResourceManagedIdentityGetter,
    AzureResourceNameGetter,
    AzureContainerRegistryServerGetter,
    AzureContainerAppFqdnGetter,
} from './azure/proprietyGetter.js';

// Register all auth providers
registerAuthProvider(new AzureManagedIdentityAuthProvider());
registerAuthProvider(new AzureEntraIDAuthProvider());

// Register all renders
registerRender(AZURE_BLOB_STORAGE_RESOURCE_TYPE, new AzureBlobStorageRender());
registerRender(AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE, new AzureContainerRegistryRender());
registerRender(AZURE_RESOURCE_GROUP, new AzureResourceGroupRender());
registerRender(AZURE_CONTAINER_APP_TYPE, new AzureContainerAppRender());
registerRender(AZURE_AD_APP_RESOURCE_TYPE, new AzureADAppRender());
registerRender(AZURE_DNS_ZONE_RESOURCE_TYPE, new AzureDnsZoneRender());
registerRender(AZURE_CONTAINER_APP_ENVIRONMENT_TYPE, new AzureContainerAppEnvironmentRender());

// Register all propriety getters
registerProprietyGetter(new AzureResourceManagedIdentityGetter());
registerProprietyGetter(new AzureResourceNameGetter());
registerProprietyGetter(new AzureContainerRegistryServerGetter());
registerProprietyGetter(new AzureContainerAppFqdnGetter());

export function initializeMerlin(): void {
    // Initialization happens during module load
    // This function exists for explicit initialization if needed
}
