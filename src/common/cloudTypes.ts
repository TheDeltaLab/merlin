/**
 * Cloud-agnostic resource type names.
 *
 * Use these as the `type:` field value in YAML resource definitions to write
 * cloud-portable resources. Merlin's init module maps each of these to the
 * appropriate cloud-specific Render implementation at runtime, based on the
 * MERLIN_CLOUD environment variable (default: 'azure').
 *
 * Example YAML usage:
 *   type: ContainerApp      # instead of AzureContainerApp
 *   type: ContainerRegistry # instead of AzureContainerRegistry
 *
 * Current Azure mappings (registered in src/init.ts):
 *   ContainerApp            → AzureContainerAppRender
 *   ContainerRegistry       → AzureContainerRegistryRender
 *   ContainerAppEnvironment → AzureContainerAppEnvironmentRender
 *   ObjectStorage           → AzureBlobStorageRender
 *   LogSink                 → AzureLogAnalyticsWorkspaceRender
 *   DnsZone                 → AzureDnsZoneRender
 *   ServicePrincipal        → AzureServicePrincipalRender
 *   AppRegistration         → AzureADAppRender
 *   KubernetesCluster       → AzureAKSRender
 *
 * Cloud-neutral K8s resource types (use kubectl/helm, same across all clouds):
 *   KubernetesNamespace     → KubernetesNamespaceRender
 *   KubernetesDeployment    → KubernetesDeploymentRender
 *   KubernetesService       → KubernetesServiceRender
 *   KubernetesIngress       → KubernetesIngressRender
 *   KubernetesHelmRelease   → KubernetesHelmReleaseRender
 *   KubernetesConfigMap     → KubernetesConfigMapRender
 *   KubernetesServiceAccount → KubernetesServiceAccountRender
 *
 * Planned Alibaba Cloud mappings (Phase 2, src/alibaba/):
 *   ContainerApp            → AlibabaSAERender  (Serverless App Engine)
 *   ContainerRegistry       → AlibabaACRRender
 *   ObjectStorage           → AlibabaOSSRender
 *   KeyValueStore           → AlibabaTairRender
 *   RelationalDatabase      → AlibabaRDSRender  (PolarDB / RDS PostgreSQL)
 *   SecretVault             → AlibabaKMSRender
 *   LogSink                 → AlibabaSLSRender  (Simple Log Service)
 *   DnsZone                 → AlibabaAlidnsRender
 *   KubernetesCluster       → AlibabaACKRender  (Alibaba Container Service for K8s)
 */

export const CONTAINER_APP_TYPE             = 'ContainerApp';
export const CONTAINER_REGISTRY_TYPE        = 'ContainerRegistry';
export const CONTAINER_APP_ENVIRONMENT_TYPE = 'ContainerAppEnvironment';
export const OBJECT_STORAGE_TYPE            = 'ObjectStorage';
export const KEY_VALUE_STORE_TYPE           = 'KeyValueStore';
export const RELATIONAL_DB_TYPE             = 'RelationalDatabase';
export const SECRET_VAULT_TYPE              = 'SecretVault';
export const LOG_SINK_TYPE                  = 'LogSink';
export const DNS_ZONE_TYPE                  = 'DnsZone';
export const SERVICE_PRINCIPAL_TYPE         = 'ServicePrincipal';
export const APP_REGISTRATION_TYPE          = 'AppRegistration';

// ── Kubernetes resource types ──────────────────────────────────────────────────
// KubernetesCluster is cloud-specific (AKS on Azure, ACK on Alibaba).
// The remaining K8s types use kubectl and are cloud-agnostic.
export const KUBERNETES_CLUSTER_TYPE      = 'KubernetesCluster';
export const KUBERNETES_NAMESPACE_TYPE    = 'KubernetesNamespace';
export const KUBERNETES_DEPLOYMENT_TYPE   = 'KubernetesDeployment';
export const KUBERNETES_SERVICE_TYPE      = 'KubernetesService';
export const KUBERNETES_INGRESS_TYPE      = 'KubernetesIngress';
export const KUBERNETES_HELM_RELEASE_TYPE = 'KubernetesHelmRelease';
export const KUBERNETES_MANIFEST_TYPE         = 'KubernetesManifest';
export const KUBERNETES_CONFIG_MAP_TYPE      = 'KubernetesConfigMap';
export const KUBERNETES_SERVICE_ACCOUNT_TYPE = 'KubernetesServiceAccount';

// ── Composite types (compile-time only, expanded before code generation) ──────
export const KUBERNETES_APP_TYPE             = 'KubernetesApp';
