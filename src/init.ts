/**
 * Initialization module - registers all providers
 * This should be imported before any generated resources
 */

import { registerAuthProvider, registerProprietyGetter, registerRender } from './common/resource.js';
import { AzureManagedIdentityAuthProvider } from './azure/authProvider.js';
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

// Register all auth providers
registerAuthProvider(new AzureManagedIdentityAuthProvider());

// Register all renders
registerRender(AZURE_BLOB_STORAGE_RESOURCE_TYPE, new AzureBlobStorageRender());
registerRender(AZURE_CONTAINER_REGISTRY_RESOURCE_TYPE, new AzureContainerRegistryRender());
registerRender(AZURE_RESOURCE_GROUP, new AzureResourceGroupRender());
registerRender(AZURE_CONTAINER_APP_TYPE, new AzureContainerAppRender());

// TODO: Register propriety getters when they're implemented

export function initializeMerlin(): void {
    // Initialization happens during module load
    // This function exists for explicit initialization if needed
}
