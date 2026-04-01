import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml, ensureNamespaceCommand } from './kubernetesNamespace.js';
import { MERLIN_YAML_FILE_PLACEHOLDER } from '../common/constants.js';

export const KUBERNETES_SERVICE_TYPE = 'KubernetesService';

export type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer';

export interface ServicePort {
    name?: string;
    port: number;
    targetPort?: number | string;
    protocol?: 'TCP' | 'UDP';
    nodePort?: number;
}

export interface KubernetesServiceConfig extends ResourceSchema {
    /** Kubernetes namespace */
    namespace: string;
    /** Service type */
    serviceType?: ServiceType;
    /** Ports to expose */
    ports: ServicePort[];
    /** Selector labels — must match deployment pod labels */
    selector?: Record<string, string>;
    /** App name to use as selector (shorthand: generates { app: appName }) */
    appName?: string;
    /** Additional labels */
    labels?: Record<string, string>;
    /** Annotations (e.g. Azure internal load balancer annotation) */
    annotations?: Record<string, string>;
    /** Azure internal load balancer (sets annotation automatically) */
    internalLoadBalancer?: boolean;
}

export interface KubernetesServiceResource extends Resource<KubernetesServiceConfig> {}

/**
 * Cloud-agnostic KubernetesService render.
 *
 * Generates a kubectl apply command with a Service manifest.
 * Service name is: <resource.name>
 *
 * For Azure internal load balancer, set internalLoadBalancer: true.
 * This adds the annotation: service.beta.kubernetes.io/azure-load-balancer-internal: "true"
 */
export class KubernetesServiceRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8ssvc';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        const ns = (resolved.config as Record<string, unknown>)?.namespace as string | undefined;
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesServiceRender.isKubernetesServiceResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesService resource`);
        }

        const config = resource.config as KubernetesServiceConfig;
        const serviceName = resource.name;

        // Build annotations
        const annotations: Record<string, string> = { ...(config.annotations ?? {}) };
        if (config.internalLoadBalancer) {
            annotations['service.beta.kubernetes.io/azure-load-balancer-internal'] = 'true';
        }

        // Build selector
        const selector = config.selector ?? (config.appName ? { app: config.appName } : { app: serviceName });

        // Build ports
        const ports = config.ports.map(p => {
            const portEntry: Record<string, unknown> = {
                port: p.port,
                targetPort: p.targetPort ?? p.port,
                protocol: p.protocol ?? 'TCP',
            };
            if (p.name) portEntry.name = p.name;
            if (p.nodePort !== undefined && (config.serviceType === 'NodePort' || config.serviceType === 'LoadBalancer')) {
                portEntry.nodePort = p.nodePort;
            }
            return portEntry;
        });

        const manifest = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                name: serviceName,
                namespace: config.namespace,
                ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
                ...(config.labels ? { labels: config.labels } : {}),
            },
            spec: {
                type: config.serviceType ?? 'ClusterIP',
                selector,
                ports,
            },
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', MERLIN_YAML_FILE_PLACEHOLDER],
            fileContent,
        }];
    }

    private static isKubernetesServiceResource(resource: Resource): resource is KubernetesServiceResource {
        return resource.type === KUBERNETES_SERVICE_TYPE;
    }
}
