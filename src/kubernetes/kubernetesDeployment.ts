import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml, ensureNamespaceCommand } from './kubernetesNamespace.js';
import { MERLIN_YAML_FILE_PLACEHOLDER } from '../common/constants.js';

export const KUBERNETES_DEPLOYMENT_TYPE = 'KubernetesDeployment';

export interface EnvFromSource {
    /** Reference a ConfigMap by its K8s metadata.name */
    configMapRef?: string;
    /** Reference a Secret by its K8s metadata.name */
    secretRef?: string;
    /** Optional prefix prepended to each key from the ConfigMap/Secret */
    prefix?: string;
}

export interface VolumeMount {
    /** Volume name (must match a volume in the pod spec) */
    name: string;
    /** Mount path inside the container */
    mountPath: string;
    /** Mount as read-only */
    readOnly?: boolean;
}

export interface ContainerSpec {
    name: string;
    image: string;
    /** Image pull policy: Always | IfNotPresent | Never (default: IfNotPresent for non-latest tags) */
    imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
    /** Environment variables as KEY=VALUE strings (same format as ACA envVars) */
    envVars?: string[];
    /** Inject all keys from ConfigMaps/Secrets as environment variables */
    envFrom?: EnvFromSource[];
    /** Port the container listens on */
    port?: number;
    /** CPU request (e.g. '250m', '0.5') */
    cpuRequest?: string;
    /** CPU limit (e.g. '500m', '1') */
    cpuLimit?: string;
    /** Memory request (e.g. '256Mi', '512Mi') */
    memoryRequest?: string;
    /** Memory limit (e.g. '512Mi', '1Gi') */
    memoryLimit?: string;
    /** Volume mounts for the container */
    volumeMounts?: VolumeMount[];
    /** Liveness probe */
    livenessProbe?: ProbeSpec;
    /** Readiness probe */
    readinessProbe?: ProbeSpec;
    /** Startup probe */
    startupProbe?: ProbeSpec;
}

export interface ProbeSpec {
    httpGet?: {
        path: string;
        port: number;
        scheme?: 'HTTP' | 'HTTPS';
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    failureThreshold?: number;
    successThreshold?: number;
}

export interface CsiVolumeSource {
    driver: string;
    readOnly?: boolean;
    volumeAttributes?: Record<string, string>;
}

export interface Volume {
    name: string;
    /** CSI volume source (e.g. secrets-store.csi.k8s.io) */
    csi?: CsiVolumeSource;
}

export interface KubernetesDeploymentConfig extends ResourceSchema {
    /** Kubernetes namespace to deploy into */
    namespace: string;
    /** Number of replicas */
    replicas?: number;
    /** Container spec(s) */
    containers: ContainerSpec[];
    /** Labels applied to pod template and selector */
    labels?: Record<string, string>;
    /** Additional labels on the pod template only (not on the deployment or selector) */
    podLabels?: Record<string, string>;
    /** Annotations on the deployment */
    annotations?: Record<string, string>;
    /** Image pull secrets (e.g. ACR credentials) */
    imagePullSecrets?: string[];
    /** Service account name */
    serviceAccountName?: string;
    /** Pod-level volumes */
    volumes?: Volume[];
}

export interface KubernetesDeploymentResource extends Resource<KubernetesDeploymentConfig> {}

/**
 * Cloud-agnostic KubernetesDeployment render.
 *
 * Generates a kubectl apply command with a Deployment manifest.
 * The deployment name is: <resource.name>-<ring>
 *
 * Assumes kubectl is configured (via az aks get-credentials or equivalent).
 */
export class KubernetesDeploymentRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8sdeploy';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        const ns = (resolved.config as Record<string, unknown>)?.namespace as string | undefined;
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesDeploymentRender.isKubernetesDeploymentResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesDeployment resource`);
        }

        const config = resource.config as KubernetesDeploymentConfig;
        const deploymentName = resource.name;
        const labels = {
            app: deploymentName,
            ring: resource.ring,
            ...(config.labels ?? {}),
        };

        // Pod template labels = deployment labels + podLabels
        const podTemplateLabels = {
            ...labels,
            ...(config.podLabels ?? {}),
        };

        // Build containers spec
        const containers = config.containers.map(c => {
            const container: Record<string, unknown> = {
                name: c.name,
                image: c.image,
            };

            // Image pull policy
            if (c.imagePullPolicy) {
                container.imagePullPolicy = c.imagePullPolicy;
            }

            // envFrom — inject entire ConfigMaps/Secrets as env vars
            // Placed before env so that K8s loads envFrom first, then env overrides
            if (c.envFrom && c.envFrom.length > 0) {
                container.envFrom = c.envFrom.map(ef => {
                    const entry: Record<string, unknown> = {};
                    if (ef.configMapRef) {
                        entry.configMapRef = { name: ef.configMapRef };
                    }
                    if (ef.secretRef) {
                        entry.secretRef = { name: ef.secretRef };
                    }
                    if (ef.prefix) {
                        entry.prefix = ef.prefix;
                    }
                    return entry;
                });
            }

            // Environment variables
            if (c.envVars && c.envVars.length > 0) {
                container.env = c.envVars.map(ev => {
                    const eqIdx = ev.indexOf('=');
                    if (eqIdx === -1) return { name: ev, value: '' };
                    return { name: ev.substring(0, eqIdx), value: ev.substring(eqIdx + 1) };
                });
            }

            // Port
            if (c.port !== undefined) {
                container.ports = [{ containerPort: c.port }];
            }

            // Resource requests/limits
            const resources: Record<string, unknown> = {};
            const requests: Record<string, string> = {};
            const limits: Record<string, string> = {};
            if (c.cpuRequest) requests.cpu = c.cpuRequest;
            if (c.memoryRequest) requests.memory = c.memoryRequest;
            if (c.cpuLimit) limits.cpu = c.cpuLimit;
            if (c.memoryLimit) limits.memory = c.memoryLimit;
            if (Object.keys(requests).length > 0) resources.requests = requests;
            if (Object.keys(limits).length > 0) resources.limits = limits;
            if (Object.keys(resources).length > 0) container.resources = resources;

            // Volume mounts
            if (c.volumeMounts && c.volumeMounts.length > 0) {
                container.volumeMounts = c.volumeMounts.map(vm => {
                    const mount: Record<string, unknown> = {
                        name: vm.name,
                        mountPath: vm.mountPath,
                    };
                    if (vm.readOnly !== undefined) {
                        mount.readOnly = vm.readOnly;
                    }
                    return mount;
                });
            }

            // Probes
            if (c.livenessProbe) container.livenessProbe = buildProbe(c.livenessProbe);
            if (c.readinessProbe) container.readinessProbe = buildProbe(c.readinessProbe);
            if (c.startupProbe) container.startupProbe = buildProbe(c.startupProbe);

            return container;
        });

        const podSpec: Record<string, unknown> = { containers };
        if (config.imagePullSecrets && config.imagePullSecrets.length > 0) {
            podSpec.imagePullSecrets = config.imagePullSecrets.map(s => ({ name: s }));
        }
        if (config.serviceAccountName) {
            podSpec.serviceAccountName = config.serviceAccountName;
        }

        // Pod-level volumes (e.g. CSI Secret Store)
        if (config.volumes && config.volumes.length > 0) {
            podSpec.volumes = config.volumes.map(v => {
                const vol: Record<string, unknown> = { name: v.name };
                if (v.csi) {
                    const csi: Record<string, unknown> = {
                        driver: v.csi.driver,
                    };
                    if (v.csi.readOnly !== undefined) {
                        csi.readOnly = v.csi.readOnly;
                    }
                    if (v.csi.volumeAttributes && Object.keys(v.csi.volumeAttributes).length > 0) {
                        csi.volumeAttributes = v.csi.volumeAttributes;
                    }
                    vol.csi = csi;
                }
                return vol;
            });
        }

        const manifest = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                name: deploymentName,
                namespace: config.namespace,
                ...(config.annotations ? { annotations: config.annotations } : {}),
                labels,
            },
            spec: {
                replicas: config.replicas ?? 1,
                selector: {
                    matchLabels: { app: deploymentName },
                },
                template: {
                    metadata: { labels: podTemplateLabels },
                    spec: podSpec,
                },
            },
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', MERLIN_YAML_FILE_PLACEHOLDER],
            fileContent,
        }];
    }

    private static isKubernetesDeploymentResource(resource: Resource): resource is KubernetesDeploymentResource {
        return resource.type === KUBERNETES_DEPLOYMENT_TYPE;
    }
}

function buildProbe(probe: ProbeSpec): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (probe.httpGet) {
        p.httpGet = {
            path: probe.httpGet.path,
            port: probe.httpGet.port,
            ...(probe.httpGet.scheme ? { scheme: probe.httpGet.scheme } : {}),
        };
    }
    if (probe.initialDelaySeconds !== undefined) p.initialDelaySeconds = probe.initialDelaySeconds;
    if (probe.periodSeconds !== undefined) p.periodSeconds = probe.periodSeconds;
    if (probe.timeoutSeconds !== undefined) p.timeoutSeconds = probe.timeoutSeconds;
    if (probe.failureThreshold !== undefined) p.failureThreshold = probe.failureThreshold;
    if (probe.successThreshold !== undefined) p.successThreshold = probe.successThreshold;
    return p;
}
