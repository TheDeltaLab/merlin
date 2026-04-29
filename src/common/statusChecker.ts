/**
 * Status checker — queries actual Azure / K8s resource status.
 *
 * Given a list of ExpandedResource[], it constructs the appropriate
 * `az` or `kubectl` CLI command for each resource and runs them in
 * parallel (with concurrency limit) to determine whether the resource
 * exists in the cloud.
 */

import { execSync } from 'child_process';
import { ExpandedResource, isParamValue, ParamValue } from '../compiler/types.js';
import { RING_SHORT_NAME_MAP, REGION_SHORT_NAME_MAP, Ring, Region } from './resource.js';

// ── Resource type → category mapping ─────────────────────────────────────────

type ResourceCategory = 'azure-arm' | 'azure-ad' | 'kubernetes' | 'helm' | 'github' | 'unknown';

const CATEGORY_MAP: Record<string, ResourceCategory> = {
    // Azure ARM resources (queried via az resource show / type-specific CLI)
    'AzureBlobStorage':               'azure-arm',
    'ObjectStorage':                   'azure-arm',
    'AzureContainerRegistry':         'azure-arm',
    'ContainerRegistry':              'azure-arm',
    'AzureContainerApp':              'azure-arm',
    'ContainerApp':                   'azure-arm',
    'AzureContainerAppEnvironment':   'azure-arm',
    'ContainerAppEnvironment':        'azure-arm',
    'AzureKeyVault':                  'azure-arm',
    'AzureDnsZone':                   'azure-arm',
    'DnsZone':                        'azure-arm',
    'AzureLogAnalyticsWorkspace':     'azure-arm',
    'LogSink':                        'azure-arm',
    'AzureRedisEnterprise':           'azure-arm',
    'AzurePostgreSQLFlexible':        'azure-arm',
    'AzureFunctionApp':               'azure-arm',
    'AzureAKSCluster':                'azure-arm',
    'KubernetesCluster':              'azure-arm',

    // Azure AD resources (queried via az ad app list)
    'AzureServicePrincipal':          'azure-ad',
    'ServicePrincipal':               'azure-ad',
    'AzureADApp':                     'azure-ad',
    'AppRegistration':                'azure-ad',

    // Kubernetes resources (queried via kubectl)
    'KubernetesNamespace':            'kubernetes',
    'KubernetesDeployment':           'kubernetes',
    'KubernetesService':              'kubernetes',
    'KubernetesIngress':              'kubernetes',
    'KubernetesConfigMap':            'kubernetes',
    'KubernetesManifest':             'kubernetes',
    'KubernetesServiceAccount':       'kubernetes',
    'KubernetesNetworkPolicy':        'kubernetes',

    // Helm releases (queried via helm list)
    'KubernetesHelmRelease':          'helm',

    // GitHub (no status check)
    'GitHubWorkflow':                 'github',
};

// Azure ARM resource type provider strings
const ARM_RESOURCE_TYPE_MAP: Record<string, string> = {
    'AzureBlobStorage':               'Microsoft.Storage/storageAccounts',
    'ObjectStorage':                   'Microsoft.Storage/storageAccounts',
    'AzureContainerRegistry':         'Microsoft.ContainerRegistry/registries',
    'ContainerRegistry':              'Microsoft.ContainerRegistry/registries',
    'AzureContainerApp':              'Microsoft.App/containerApps',
    'ContainerApp':                   'Microsoft.App/containerApps',
    'AzureContainerAppEnvironment':   'Microsoft.App/managedEnvironments',
    'ContainerAppEnvironment':        'Microsoft.App/managedEnvironments',
    'AzureKeyVault':                  'Microsoft.KeyVault/vaults',
    'AzureDnsZone':                   'Microsoft.Network/dnsZones',
    'DnsZone':                        'Microsoft.Network/dnsZones',
    'AzureLogAnalyticsWorkspace':     'Microsoft.OperationalInsights/workspaces',
    'LogSink':                        'Microsoft.OperationalInsights/workspaces',
    'AzureRedisEnterprise':           'Microsoft.Cache/redisEnterprise',
    'AzurePostgreSQLFlexible':        'Microsoft.DBforPostgreSQL/flexibleServers',
    'AzureFunctionApp':               'Microsoft.Web/sites',
    'AzureAKSCluster':                'Microsoft.ContainerService/managedClusters',
    'KubernetesCluster':              'Microsoft.ContainerService/managedClusters',
};

// Short resource type name map (matches Render.getShortResourceTypeName())
const SHORT_TYPE_NAME_MAP: Record<string, string> = {
    'AzureBlobStorage': 'abs',
    'ObjectStorage': 'abs',
    'AzureContainerRegistry': 'acr',
    'ContainerRegistry': 'acr',
    'AzureContainerApp': 'aca',
    'ContainerApp': 'aca',
    'AzureContainerAppEnvironment': 'acenv',
    'ContainerAppEnvironment': 'acenv',
    'AzureKeyVault': 'akv',
    'AzureDnsZone': 'dnszone',
    'DnsZone': 'dnszone',
    'AzureLogAnalyticsWorkspace': 'law',
    'LogSink': 'law',
    'AzureRedisEnterprise': 'redis',
    'AzurePostgreSQLFlexible': 'pg',
    'AzureFunctionApp': 'func',
    'AzureAKSCluster': 'aks',
    'KubernetesCluster': 'aks',
    'AzureServicePrincipal': 'sp',
    'ServicePrincipal': 'sp',
    'AzureADApp': 'aad',
    'AppRegistration': 'aad',
};

// Whether a type uses connectors (hyphens) in resource name
const SUPPORTS_CONNECTOR: Record<string, boolean> = {
    'AzureBlobStorage': false,
    'ObjectStorage': false,
    'AzureContainerRegistry': false,
    'ContainerRegistry': false,
    'AzureContainerApp': true,
    'ContainerApp': true,
    'AzureContainerAppEnvironment': true,
    'ContainerAppEnvironment': true,
    'AzureKeyVault': false,
    'AzureDnsZone': true,
    'DnsZone': true,
    'AzureLogAnalyticsWorkspace': true,
    'LogSink': true,
    'AzureRedisEnterprise': true,
    'AzurePostgreSQLFlexible': true,
    'AzureFunctionApp': true,
    'AzureAKSCluster': true,
    'KubernetesCluster': true,
    'AzureServicePrincipal': true,
    'ServicePrincipal': true,
    'AzureADApp': true,
    'AppRegistration': true,
};

// Global resource types (no region in naming)
const GLOBAL_TYPES = new Set([
    'AzureServicePrincipal', 'ServicePrincipal',
    'AzureADApp', 'AppRegistration',
    'AzureDnsZone', 'DnsZone',
]);

// K8s type → kubectl kind mapping
const K8S_KIND_MAP: Record<string, string> = {
    'KubernetesNamespace':      'namespace',
    'KubernetesDeployment':     'deployment',
    'KubernetesService':        'service',
    'KubernetesIngress':        'ingress',
    'KubernetesConfigMap':      'configmap',
    'KubernetesServiceAccount': 'serviceaccount',
    'KubernetesNetworkPolicy':  'networkpolicy',
};

// ── Status result types ──────────────────────────────────────────────────────

export type ResourceStatus = 'exists' | 'not-found' | 'error' | 'skip';

export interface ResourceStatusResult {
    resource: ExpandedResource;
    status: ResourceStatus;
    cloudName: string;   // The actual name used in Azure/K8s (e.g. "merlinsharedstgkrcabs", "alluneed (alluneed ns)")
    detail?: string;     // e.g. "deployed", "appId: xxx", error message
}

// ── Naming helpers (mirror AzureResourceRender logic) ────────────────────────

function getResourceGroupName(resource: ExpandedResource): string {
    const projectPart = resource.project ?? 'shared';
    const ringPart = `rg-${RING_SHORT_NAME_MAP[resource.ring as Ring] ?? resource.ring}`;
    const regionPart = resource.region ? (REGION_SHORT_NAME_MAP[resource.region as Region] ?? resource.region) : '';
    return [projectPart, ringPart, regionPart].filter(Boolean).join('-');
}

function getAzureResourceName(resource: ExpandedResource): string {
    const projectPart = resource.project ?? 'shared';
    const ringPart = RING_SHORT_NAME_MAP[resource.ring as Ring] ?? resource.ring;
    const regionPart = resource.region ? (REGION_SHORT_NAME_MAP[resource.region as Region] ?? resource.region) : '';
    const typePart = SHORT_TYPE_NAME_MAP[resource.type] ?? '';
    const connector = (SUPPORTS_CONNECTOR[resource.type] ?? true) ? '-' : '';
    return [projectPart, resource.name, ringPart, regionPart, typePart].filter(Boolean).join(connector);
}

function getDisplayName(resource: ExpandedResource): string {
    // For SP/AAD, config.displayName takes precedence over generated name
    const configDisplayName = resource.config?.displayName;
    if (typeof configDisplayName === 'string') {
        return configDisplayName;
    }
    // Handle ParamValue (e.g. "merlin-alluneed-aad-${ this.ring }")
    if (isParamValue(configDisplayName)) {
        return resolveParamValueLocally(configDisplayName, resource);
    }
    return getAzureResourceName(resource);
}

/**
 * Resolves a ParamValue locally using only `this.ring` and `this.region`.
 * Dependency expressions (${ Type.name.export }) cannot be resolved here,
 * so they are replaced with a placeholder.
 */
function resolveParamValueLocally(pv: ParamValue, resource: ExpandedResource): string {
    return pv.segments.map(seg => {
        if (seg.type === 'literal') return seg.value;
        if (seg.type === 'self') {
            if (seg.field === 'ring') return resource.ring;
            if (seg.field === 'region') return resource.region ?? '';
        }
        // dep references can't be resolved — use placeholder
        return `<${seg.type}>`;
    }).join('');
}

// ── Status checking ──────────────────────────────────────────────────────────

function execQuiet(cmd: string): { ok: boolean; stdout: string } {
    try {
        const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return { ok: true, stdout };
    } catch {
        return { ok: false, stdout: '' };
    }
}

/**
 * Returns the human-readable cloud resource name for display.
 * - Azure ARM: "resourceName (rgName)" e.g. "merlinsharedstgkrcabs (merlin-rg-stg-krc)"
 * - Azure AD (SP/AAD): displayName e.g. "merlin-alluneed-aad-staging"
 * - K8s: "name (namespace ns)" e.g. "alluneed (alluneed ns)" or just "alluneed" for namespaces
 * - Helm: "releaseName (namespace ns)" e.g. "cert-manager (cert-manager ns)"
 */
export function getCloudResourceName(resource: ExpandedResource): string {
    const category = CATEGORY_MAP[resource.type] ?? 'unknown';

    switch (category) {
        case 'azure-arm': {
            if (resource.type === 'AzureDnsZone' || resource.type === 'DnsZone') {
                const dnsName = resource.config?.dnsName as string | undefined;
                return dnsName ?? getAzureResourceName(resource);
            }
            const name = getAzureResourceName(resource);
            const rg = getResourceGroupName(resource);
            return `${name} (${rg})`;
        }
        case 'azure-ad':
            return getDisplayName(resource);
        case 'kubernetes': {
            const kind = K8S_KIND_MAP[resource.type];
            if (kind === 'namespace') {
                const ns = resource.config?.namespace as string ?? resource.name;
                return `namespace/${ns}`;
            }
            const namespace = resource.config?.namespace as string | undefined;
            return namespace ? `${resource.name} (${namespace} ns)` : resource.name;
        }
        case 'helm': {
            const releaseName = resource.config?.releaseName as string ?? resource.name;
            const namespace = resource.config?.namespace as string | undefined;
            return namespace ? `${releaseName} (${namespace} ns)` : releaseName;
        }
        default:
            return resource.name;
    }
}

function checkAzureArmResource(resource: ExpandedResource): ResourceStatusResult {
    const rg = getResourceGroupName(resource);
    const name = getAzureResourceName(resource);
    const armType = ARM_RESOURCE_TYPE_MAP[resource.type];
    const cloudName = getCloudResourceName(resource);

    if (!armType) {
        return { resource, status: 'skip', cloudName, detail: 'Unknown ARM type' };
    }

    // DNS zones are global (no region in RG name) — use a special RG calculation
    // For DNS zones, the resource name is actually the zone name from config, not the generated name
    if (resource.type === 'AzureDnsZone' || resource.type === 'DnsZone') {
        const dnsName = resource.config?.dnsName as string | undefined;
        const zoneName = dnsName ?? name;
        // Try to find the zone by listing all zones matching the name
        const { ok, stdout } = execQuiet(
            `az network dns zone list --query "[?name=='${zoneName}'].{name:name, rg:resourceGroup}" -o tsv`
        );
        if (ok && stdout.length > 0) {
            return { resource, status: 'exists', cloudName };
        }
        return { resource, status: 'not-found', cloudName };
    }

    const { ok } = execQuiet(
        `az resource show --resource-group "${rg}" --resource-type "${armType}" --name "${name}" --query id -o tsv`
    );
    return { resource, status: ok ? 'exists' : 'not-found', cloudName };
}

function checkAzureAdResource(resource: ExpandedResource): ResourceStatusResult {
    const displayName = getDisplayName(resource);
    const cloudName = displayName;
    // displayName may contain unresolved expressions — skip those
    if (displayName.includes('${') || displayName.includes('<dep>')) {
        // Try with the generated name fallback
        const fallback = getAzureResourceName(resource);
        const { ok, stdout } = execQuiet(
            `az ad app list --filter "displayName eq '${fallback}'" --query "[0].appId" -o tsv`
        );
        if (ok && stdout.length > 0) {
            return { resource, status: 'exists', cloudName: fallback, detail: `appId: ${stdout}` };
        }
        return { resource, status: 'not-found', cloudName: fallback, detail: 'displayName has unresolved expressions' };
    }

    const { ok, stdout } = execQuiet(
        `az ad app list --filter "displayName eq '${displayName}'" --query "[0].appId" -o tsv`
    );
    if (ok && stdout.length > 0) {
        return { resource, status: 'exists', cloudName, detail: `appId: ${stdout}` };
    }
    return { resource, status: 'not-found', cloudName };
}

function checkKubernetesResource(resource: ExpandedResource): ResourceStatusResult {
    const kind = K8S_KIND_MAP[resource.type];
    const cloudName = getCloudResourceName(resource);
    if (!kind) {
        // KubernetesManifest — skip, we don't know the kind
        return { resource, status: 'skip', cloudName, detail: 'Manifest — cannot determine kind' };
    }

    const namespace = resource.config?.namespace as string | undefined;
    const name = resource.name;

    if (kind === 'namespace') {
        const ns = namespace ?? name;
        const { ok } = execQuiet(`kubectl get namespace "${ns}" -o name`);
        return { resource, status: ok ? 'exists' : 'not-found', cloudName };
    }

    if (!namespace) {
        return { resource, status: 'error', cloudName, detail: 'No namespace in config' };
    }

    const { ok } = execQuiet(`kubectl get ${kind} "${name}" -n "${namespace}" -o name`);
    return { resource, status: ok ? 'exists' : 'not-found', cloudName };
}

function checkHelmRelease(resource: ExpandedResource): ResourceStatusResult {
    const releaseName = resource.config?.releaseName as string | undefined;
    const namespace = resource.config?.namespace as string | undefined;
    const cloudName = getCloudResourceName(resource);

    if (!releaseName || !namespace) {
        return { resource, status: 'error', cloudName, detail: 'Missing releaseName or namespace' };
    }

    // Use helm list with filter — much lighter than helm status (which dumps all manifests)
    const { ok, stdout } = execQuiet(
        `helm list -n "${namespace}" --filter "^${releaseName}$" --output json`
    );
    if (ok && stdout.length > 2) { // '[]' is empty
        try {
            const releases = JSON.parse(stdout);
            if (Array.isArray(releases) && releases.length > 0) {
                const status = releases[0]?.status ?? 'unknown';
                return { resource, status: 'exists', cloudName, detail: status };
            }
        } catch { /* fall through */ }
    }
    return { resource, status: 'not-found', cloudName };
}

function checkSingle(resource: ExpandedResource): ResourceStatusResult {
    const category = CATEGORY_MAP[resource.type] ?? 'unknown';
    const cloudName = getCloudResourceName(resource);

    switch (category) {
        case 'azure-arm':
            return checkAzureArmResource(resource);
        case 'azure-ad':
            return checkAzureAdResource(resource);
        case 'kubernetes':
            return checkKubernetesResource(resource);
        case 'helm':
            return checkHelmRelease(resource);
        case 'github':
            return { resource, status: 'skip', cloudName, detail: 'GitHub workflow' };
        default:
            return { resource, status: 'skip', cloudName, detail: `Unknown type: ${resource.type}` };
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks the actual status of each resource by querying Azure / K8s.
 * Returns results in the same order as the input array.
 *
 * Runs checks sequentially to avoid overwhelming CLI tools, but each check
 * has a 15s timeout so the total time is bounded.
 */
export function checkResourceStatuses(resources: ExpandedResource[]): ResourceStatusResult[] {
    return resources.map(r => {
        try {
            return checkSingle(r);
        } catch (error) {
            return {
                resource: r,
                status: 'error' as ResourceStatus,
                cloudName: getCloudResourceName(r),
                detail: error instanceof Error ? error.message : String(error),
            };
        }
    });
}

/**
 * De-duplicates resources by type+name (ignoring ring/region) and aggregates
 * status across all instances. If ANY instance exists, the aggregate is 'exists'.
 */
export interface AggregatedStatus {
    type: string;
    name: string;
    project: string;
    rings: Set<string>;
    regions: Set<string>;
    statuses: Map<string, ResourceStatus>;  // key: "ring:region"
    details: Map<string, string>;           // key: "ring:region"
}

export function aggregateStatuses(results: ResourceStatusResult[]): AggregatedStatus[] {
    const grouped = new Map<string, AggregatedStatus>();

    for (const r of results) {
        const key = `${r.resource.type}.${r.resource.name}`;
        const ringRegionKey = `${r.resource.ring}:${r.resource.region ?? 'global'}`;

        const existing = grouped.get(key);
        if (existing) {
            existing.rings.add(r.resource.ring);
            if (r.resource.region) existing.regions.add(r.resource.region);
            existing.statuses.set(ringRegionKey, r.status);
            if (r.detail) existing.details.set(ringRegionKey, r.detail);
        } else {
            grouped.set(key, {
                type: r.resource.type,
                name: r.resource.name,
                project: r.resource.project ?? 'shared',
                rings: new Set([r.resource.ring]),
                regions: new Set(r.resource.region ? [r.resource.region] : []),
                statuses: new Map([[ringRegionKey, r.status]]),
                details: new Map(r.detail ? [[ringRegionKey, r.detail]] : []),
            });
        }
    }

    return [...grouped.values()];
}
