/**
 * KubernetesApp composite type expander.
 *
 * Expands a single `KubernetesApp` resource YAML into multiple standard
 * resource YAMLs (KubernetesDeployment + KubernetesService + KubernetesIngress)
 * at compile time. All existing renders remain unchanged — the expander
 * outputs standard types that the existing pipeline already handles.
 */

import type { ResourceYAML } from './schemas.js';

// ── Default values ───────────────────────────────────────────────────────────

const DEFAULT_REPLICAS = 1;
const DEFAULT_HEALTH_PATH = '/';
const DEFAULT_CPU_REQUEST = '250m';
const DEFAULT_MEMORY_REQUEST = '512Mi';
const DEFAULT_CPU_LIMIT = '500m';
const DEFAULT_MEMORY_LIMIT = '1Gi';
const DEFAULT_IMAGE_PULL_POLICY = 'IfNotPresent';
const DEFAULT_INGRESS_CLASS = 'nginx';
const DEFAULT_CLUSTER_ISSUER = 'letsencrypt-prod';
const DEFAULT_INGRESS_PATH = '/';

// ── Types ────────────────────────────────────────────────────────────────────

export interface KubernetesAppConfig {
    namespace: string;
    image: string;
    port: number;
    containerName?: string;
    replicas?: number;
    healthPath?: string;
    imagePullPolicy?: string;
    resources?: {
        cpuRequest?: string;
        memoryRequest?: string;
        cpuLimit?: string;
        memoryLimit?: string;
    };
    serviceAccountName?: string;
    secretProvider?: string;
    envFrom?: Array<Record<string, string>>;
    envVars?: string[];
    ingress?: {
        subdomain: string;
        dnsZone: string;
        path?: string;
        clusterIssuer?: string;
        ingressClassName?: string;
        annotations?: Record<string, string>;
        bindDnsZone?: boolean;
        /** Extra ingress dependencies (e.g. oauth2-proxy) */
        dependencies?: Array<{ resource: string; isHardDependency?: boolean }>;
    };
    /** Probes — set to false to disable, or override specific probe config */
    probes?: false | {
        liveness?: Record<string, unknown> | false;
        readiness?: Record<string, unknown> | false;
        startup?: Record<string, unknown> | false;
    };
    /** Override any Deployment config field directly */
    deploymentOverrides?: Record<string, unknown>;
    /** Override any Service config field directly */
    serviceOverrides?: Record<string, unknown>;
    /** Override any Ingress config field directly */
    ingressOverrides?: Record<string, unknown>;
}

// ── Main expander ────────────────────────────────────────────────────────────

/**
 * Expands a KubernetesApp ResourceYAML into standard resource YAMLs.
 * Returns 2-3 ResourceYAML objects (Deployment + Service, optionally + Ingress).
 */
export function expandKubernetesApp(resource: ResourceYAML): ResourceYAML[] {
    const config = resource.defaultConfig as unknown as KubernetesAppConfig;
    const results: ResourceYAML[] = [];

    // 1. KubernetesDeployment (always)
    results.push(buildDeploymentResource(resource, config));

    // 2. KubernetesService (always)
    results.push(buildServiceResource(resource, config));

    // 3. KubernetesIngress (if ingress config is present)
    if (config.ingress) {
        results.push(buildIngressResource(resource, config));
    }

    return results;
}

// ── Builders ─────────────────────────────────────────────────────────────────

function buildDeploymentResource(resource: ResourceYAML, config: KubernetesAppConfig): ResourceYAML {
    const port = config.port;
    const healthPath = config.healthPath ?? DEFAULT_HEALTH_PATH;
    const containerName = config.containerName ?? resource.name.split('-').pop() ?? resource.name;
    const res = config.resources ?? {};

    // Build container spec
    const container: Record<string, unknown> = {
        name: containerName,
        image: config.image,
        imagePullPolicy: config.imagePullPolicy ?? DEFAULT_IMAGE_PULL_POLICY,
        port,
        cpuRequest: res.cpuRequest ?? DEFAULT_CPU_REQUEST,
        memoryRequest: res.memoryRequest ?? DEFAULT_MEMORY_REQUEST,
        cpuLimit: res.cpuLimit ?? DEFAULT_CPU_LIMIT,
        memoryLimit: res.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
    };

    if (config.envFrom) {
        container.envFrom = config.envFrom;
    }
    if (config.envVars) {
        container.envVars = config.envVars;
    }

    // Probes — default standard probes unless explicitly disabled
    if (config.probes !== false) {
        const probeConfig = config.probes ?? {};

        if (probeConfig.liveness !== false) {
            container.livenessProbe = probeConfig.liveness ?? {
                httpGet: { path: healthPath, port },
                periodSeconds: 10,
                timeoutSeconds: 5,
                failureThreshold: 3,
            };
        }
        if (probeConfig.readiness !== false) {
            container.readinessProbe = probeConfig.readiness ?? {
                httpGet: { path: healthPath, port },
                periodSeconds: 5,
                timeoutSeconds: 5,
                failureThreshold: 48,
            };
        }
        if (probeConfig.startup !== false) {
            container.startupProbe = probeConfig.startup ?? {
                httpGet: { path: healthPath, port },
                initialDelaySeconds: 1,
                periodSeconds: 1,
                timeoutSeconds: 3,
                failureThreshold: 240,
            };
        }
    }

    // Secret volume mount
    if (config.secretProvider) {
        container.volumeMounts = [
            { name: 'secrets-store', mountPath: '/mnt/secrets-store', readOnly: true }
        ];
    }

    // Build deployment config
    const deploymentConfig: Record<string, unknown> = {
        namespace: config.namespace,
        replicas: config.replicas ?? DEFAULT_REPLICAS,
        containers: [container],
    };

    // Workload identity
    if (config.serviceAccountName) {
        deploymentConfig.serviceAccountName = config.serviceAccountName;
        deploymentConfig.podLabels = { 'azure.workload.identity/use': 'true' };
    }

    // CSI secrets volume
    if (config.secretProvider) {
        deploymentConfig.volumes = [{
            name: 'secrets-store',
            csi: {
                driver: 'secrets-store.csi.k8s.io',
                readOnly: true,
                volumeAttributes: {
                    secretProviderClass: config.secretProvider,
                },
            },
        }];
    }

    // Apply deployment overrides
    if (config.deploymentOverrides) {
        Object.assign(deploymentConfig, config.deploymentOverrides);
    }

    // Build dependencies — auto-add KubernetesCluster.aks
    const deps = [...(resource.dependencies ?? [])];
    const depNames = new Set(deps.map(d => d.resource));
    if (!depNames.has('KubernetesCluster.aks')) {
        deps.unshift({ resource: 'KubernetesCluster.aks', isHardDependency: true });
    }

    // Forward specificConfig entries to Deployment (only non-ingress fields)
    const deploymentSpecificConfig = (resource.specificConfig ?? []).map(sc => {
        const { ingress, ...rest } = sc as Record<string, unknown>;
        return rest;
    }).filter(sc => {
        // Keep only entries that have config fields beyond ring/region
        const { ring, region, ...fields } = sc;
        return Object.keys(fields).length > 0;
    });

    return {
        name: resource.name,
        type: 'KubernetesDeployment',
        project: resource.project,
        ring: resource.ring,
        region: resource.region,
        authProvider: resource.authProvider,
        dependencies: deps,
        defaultConfig: deploymentConfig,
        specificConfig: deploymentSpecificConfig,
        exports: {},
    } as ResourceYAML;
}

function buildServiceResource(resource: ResourceYAML, config: KubernetesAppConfig): ResourceYAML {
    const serviceConfig: Record<string, unknown> = {
        namespace: config.namespace,
        serviceType: 'ClusterIP',
        appName: resource.name,
        ports: [{ port: config.port, targetPort: config.port }],
    };

    if (config.serviceOverrides) {
        Object.assign(serviceConfig, config.serviceOverrides);
    }

    return {
        name: resource.name,
        type: 'KubernetesService',
        project: resource.project,
        ring: resource.ring,
        region: resource.region,
        authProvider: resource.authProvider,
        dependencies: [
            { resource: `KubernetesDeployment.${resource.name}`, isHardDependency: true },
        ],
        defaultConfig: serviceConfig,
        specificConfig: [],
        exports: {},
    } as ResourceYAML;
}

function buildIngressResource(resource: ResourceYAML, config: KubernetesAppConfig): ResourceYAML {
    const ingress = config.ingress!;
    const ingressClassName = ingress.ingressClassName ?? DEFAULT_INGRESS_CLASS;
    const clusterIssuer = ingress.clusterIssuer ?? DEFAULT_CLUSTER_ISSUER;
    const ingressPath = ingress.path ?? DEFAULT_INGRESS_PATH;

    // Use ${ this.ring } interpolation for dynamic host — eliminates specificConfig
    const host = `${ingress.subdomain}.\${ this.ring }.${ingress.dnsZone}`;

    const ingressConfig: Record<string, unknown> = {
        namespace: config.namespace,
        ingressClassName,
        clusterIssuer,
        rules: [{
            host,
            paths: [{
                path: ingressPath,
                pathType: 'Prefix',
                serviceName: resource.name,
                servicePort: config.port,
            }],
        }],
        tls: [{
            hosts: [host],
            secretName: `${resource.name}-tls`,
        }],
    };

    // bindDnsZone defaults to true
    if (ingress.bindDnsZone !== false) {
        ingressConfig.bindDnsZone = { dnsZone: ingress.dnsZone };
    }

    if (ingress.annotations) {
        ingressConfig.annotations = ingress.annotations;
    }

    if (config.ingressOverrides) {
        Object.assign(ingressConfig, config.ingressOverrides);
    }

    // Dependencies: service + any extra ingress deps
    const deps = [
        { resource: `KubernetesService.${resource.name}`, isHardDependency: true },
        ...(ingress.dependencies ?? []),
    ];

    return {
        name: resource.name,
        type: 'KubernetesIngress',
        project: resource.project,
        ring: resource.ring,
        region: resource.region,
        authProvider: resource.authProvider,
        dependencies: deps,
        defaultConfig: ingressConfig,
        specificConfig: [],
        exports: {},
    } as ResourceYAML;
}
