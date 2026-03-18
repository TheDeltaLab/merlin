/**
 * Alibaba Cloud provider — Phase 2 placeholder
 *
 * When implemented, register these renders in src/init.ts under the
 * `cloud === 'alibaba'` branch using cloud-agnostic type names from
 * src/common/cloudTypes.ts.
 *
 * Planned render implementations:
 *
 *   ContainerApp        → AlibabaSAERender
 *                         (Serverless App Engine — closest equivalent to Azure Container Apps)
 *
 *   ContainerRegistry   → AlibabaACRRender
 *                         (Container Registry — same concept as Azure ACR)
 *
 *   ContainerAppEnvironment → AlibabaSAENamespaceRender
 *                         (SAE Namespace groups apps with shared networking)
 *
 *   ObjectStorage       → AlibabaOSSRender
 *                         (Object Storage Service — equivalent to Azure Blob Storage)
 *
 *   KeyValueStore       → AlibabaTairRender
 *                         (Tair / ApsaraDB for Redis — equivalent to Azure Redis Enterprise)
 *
 *   RelationalDatabase  → AlibabaRDSRender
 *                         (ApsaraDB RDS PostgreSQL / PolarDB)
 *
 *   SecretVault         → AlibabaKMSRender
 *                         (Key Management Service — equivalent to Azure Key Vault)
 *
 *   LogSink             → AlibabaSLSRender
 *                         (Simple Log Service — equivalent to Azure Log Analytics)
 *
 *   DnsZone             → AlibabaAlidnsRender
 *                         (Alibaba Cloud DNS — equivalent to Azure DNS Zone)
 *
 *   ServicePrincipal    → AlibabaRAMUserRender
 *                         (RAM User + OIDC Provider — equivalent to Azure Service Principal)
 *
 *   AppRegistration     → AlibabaRAMRoleRender
 *                         (RAM Role for service identity — equivalent to Azure AD App)
 *
 * Authentication differences from Azure:
 *   - No Managed Identity; use RAM Role attached to ECS/SAE instance
 *   - OIDC federation via RAM OIDC Provider (similar to Azure Federated Credentials)
 *   - aliyun CLI used instead of az CLI
 *
 * Region format differs: 'cn-hangzhou', 'cn-shanghai', etc.
 * (defined in src/common/resource.ts REGION_SHORT_NAME_MAP)
 */

export {};
