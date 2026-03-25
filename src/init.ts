/**
 * Initialization module - registers all providers
 *
 * Reads MERLIN_CLOUD env variable (default: 'azure') to determine which
 * cloud provider implementations to register. Supports two registration paths:
 *
 *   ① Cloud-agnostic type names (e.g. 'ContainerApp') → cloud-specific Render
 *      Use these in new YAML files for cloud-portable resource definitions.
 *
 *   ② Azure-specific type names (e.g. 'AzureContainerApp') → Azure Render
 *      Kept for backwards compatibility — all existing YAML files continue to work.
 *
 * This module should be imported before any generated resources.
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
    AZURE_LOG_ANALYTICS_WORKSPACE_RESOURCE_TYPE,
    AzureLogAnalyticsWorkspaceRender
} from './azure/azureLogAnalyticsWorkspace.js';
import {
    AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
    AzureServicePrincipalRender
} from './azure/azureServicePrincipal.js';
import {
    AZURE_KEY_VAULT_RESOURCE_TYPE, AzureKeyVaultRender,
} from './azure/azureKeyVault.js';
import {
    AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE, AzureRedisEnterpriseRender,
} from './azure/azureRedisEnterprise.js';
import {
    AZURE_POSTGRESQL_RESOURCE_TYPE, AzurePostgreSQLFlexibleRender,
} from './azure/azurePostgreSQLFlexible.js';
import {
    AZURE_FUNCTION_APP_RESOURCE_TYPE, AzureFunctionAppRender,
} from './azure/azureFunctionApp.js';
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
} from './azure/proprietyGetter.js';
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
    KUBERNETES_NAMESPACE_TYPE,
    KUBERNETES_DEPLOYMENT_TYPE,
    KUBERNETES_SERVICE_TYPE,
    KUBERNETES_INGRESS_TYPE,
    KUBERNETES_HELM_RELEASE_TYPE,
    KUBERNETES_MANIFEST_TYPE,
    KUBERNETES_CONFIG_MAP_TYPE,
    KUBERNETES_SERVICE_ACCOUNT_TYPE,
} from './common/cloudTypes.js';
import {
    AZURE_AKS_TYPE,
    AzureAKSRender,
} from './kubernetes/kubernetesCluster.js';
import { KubernetesNamespaceRender } from './kubernetes/kubernetesNamespace.js';
import { KubernetesDeploymentRender } from './kubernetes/kubernetesDeployment.js';
import { KubernetesServiceRender } from './kubernetes/kubernetesService.js';
import { KubernetesIngressRender } from './kubernetes/kubernetesIngress.js';
import { KubernetesHelmReleaseRender } from './kubernetes/kubernetesHelmRelease.js';
import { KubernetesManifestRender } from './kubernetes/kubernetesManifest.js';
import { KubernetesConfigMapRender } from './kubernetes/kubernetesConfigMap.js';
import { KubernetesServiceAccountRender } from './kubernetes/kubernetesServiceAccount.js';
import {
    GITHUB_WORKFLOW_RESOURCE_TYPE,
    GitHubWorkflowRender,
} from './github/githubWorkflow.js';

// ── Cloud selection ────────────────────────────────────────────────────────────

const cloud = (process.env.MERLIN_CLOUD ?? 'azure').toLowerCase();

if (cloud === 'azure') {
    // ① Cloud-agnostic type names → Azure implementations
    //    Use these in new YAML files: `type: ContainerApp` instead of `type: AzureContainerApp`
    registerRender(CONTAINER_APP_TYPE,             new AzureContainerAppRender());
    registerRender(CONTAINER_REGISTRY_TYPE,        new AzureContainerRegistryRender());
    registerRender(CONTAINER_APP_ENVIRONMENT_TYPE, new AzureContainerAppEnvironmentRender());
    registerRender(OBJECT_STORAGE_TYPE,            new AzureBlobStorageRender());
    registerRender(LOG_SINK_TYPE,                  new AzureLogAnalyticsWorkspaceRender());
    registerRender(DNS_ZONE_TYPE,                  new AzureDnsZoneRender());
    registerRender(SERVICE_PRINCIPAL_TYPE,         new AzureServicePrincipalRender());
    registerRender(APP_REGISTRATION_TYPE,          new AzureADAppRender());
    registerRender(KUBERNETES_CLUSTER_TYPE,        new AzureAKSRender());

    // ② Azure-specific type names → same Azure implementations (backwards compatibility)
    //    All existing YAML files using Azure* types continue to work without changes.
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

} else if (cloud === 'alibaba') {
    throw new Error(
        'Alibaba Cloud provider is not yet implemented. ' +
        'Phase 2 implementation is in progress. ' +
        'See src/alibaba/ for the planned structure.'
    );
} else {
    throw new Error(
        `Unknown cloud provider: "${cloud}". Supported values: azure, alibaba`
    );
}

// ── Cloud-neutral resources ────────────────────────────────────────────────────
registerRender(GITHUB_WORKFLOW_RESOURCE_TYPE, new GitHubWorkflowRender());

// ── Cloud-neutral Kubernetes resources (use kubectl/helm, work on any cluster) ──
registerRender(KUBERNETES_NAMESPACE_TYPE,    new KubernetesNamespaceRender());
registerRender(KUBERNETES_DEPLOYMENT_TYPE,   new KubernetesDeploymentRender());
registerRender(KUBERNETES_SERVICE_TYPE,      new KubernetesServiceRender());
registerRender(KUBERNETES_INGRESS_TYPE,      new KubernetesIngressRender());
registerRender(KUBERNETES_HELM_RELEASE_TYPE, new KubernetesHelmReleaseRender());
registerRender(KUBERNETES_MANIFEST_TYPE,     new KubernetesManifestRender());
registerRender(KUBERNETES_CONFIG_MAP_TYPE,   new KubernetesConfigMapRender());
registerRender(KUBERNETES_SERVICE_ACCOUNT_TYPE, new KubernetesServiceAccountRender());

// ── Auth providers ─────────────────────────────────────────────────────────────
// Currently Azure-only. Phase 2 will add Alibaba RAM/OIDC auth providers.

registerAuthProvider(new AzureManagedIdentityAuthProvider());
registerAuthProvider(new AzureEntraIDAuthProvider());

// ── Propriety getters ──────────────────────────────────────────────────────────
// Currently Azure-only. Phase 2 will add Alibaba-specific getters.

registerProprietyGetter(new AzureResourceManagedIdentityGetter());
registerProprietyGetter(new AzureResourceNameGetter());
registerProprietyGetter(new AzureContainerRegistryServerGetter());
registerProprietyGetter(new AzureContainerAppFqdnGetter());
registerProprietyGetter(new AzureLogAnalyticsWorkspaceCustomerIdGetter());
registerProprietyGetter(new AzureLogAnalyticsWorkspaceSharedKeyGetter());
registerProprietyGetter(new AzureDnsZoneNameGetter());
registerProprietyGetter(new AzureADAppClientIdGetter());
registerProprietyGetter(new AzureKeyVaultUrlGetter());
registerProprietyGetter(new AzureServicePrincipalClientIdGetter());
registerProprietyGetter(new AzureRedisEnterpriseUrlGetter());
registerProprietyGetter(new AzureResourceApiScopeGetter());
registerProprietyGetter(new AzureAKSOidcIssuerUrlGetter());

export function initializeMerlin(): void {
    // Initialization happens during module load via the side-effects above.
    // This function exists for explicit initialization if needed.
}
