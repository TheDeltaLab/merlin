import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml } from './kubernetesNamespace.js';

export const KUBERNETES_INGRESS_TYPE = 'KubernetesIngress';

export interface IngressRule {
    /** Hostname for this rule (e.g. api.example.com) */
    host: string;
    /** HTTP path rules */
    paths: IngressPath[];
}

export interface IngressPath {
    /** URL path (e.g. /, /api) */
    path: string;
    /** Path match type */
    pathType?: 'Prefix' | 'Exact' | 'ImplementationSpecific';
    /** Backend service name */
    serviceName: string;
    /** Backend service port */
    servicePort: number;
}

export interface KubernetesIngressConfig extends ResourceSchema {
    /** Kubernetes namespace */
    namespace: string;
    /** Ingress class name (e.g. nginx) */
    ingressClassName?: string;
    /** Ingress rules */
    rules: IngressRule[];
    /** TLS configuration — list of hosts + cert-manager secret name */
    tls?: Array<{
        hosts: string[];
        secretName: string;
    }>;
    /** cert-manager cluster issuer name (adds cert-manager.io/cluster-issuer annotation) */
    clusterIssuer?: string;
    /** Additional annotations */
    annotations?: Record<string, string>;
    /** Additional labels */
    labels?: Record<string, string>;
}

export interface KubernetesIngressResource extends Resource<KubernetesIngressConfig> {}

/**
 * Cloud-agnostic KubernetesIngress render.
 *
 * Generates a kubectl apply command with an Ingress manifest.
 * Ingress name is: <resource.name>
 *
 * cert-manager integration:
 *   Set clusterIssuer: 'letsencrypt-prod' and provide tls[] entries.
 *   This adds the annotation cert-manager.io/cluster-issuer automatically.
 *
 * NGINX Ingress:
 *   Set ingressClassName: 'nginx'
 *
 * Example YAML usage:
 *   type: KubernetesIngress
 *   defaultConfig:
 *     namespace: trinity
 *     ingressClassName: nginx
 *     clusterIssuer: letsencrypt-prod
 *     rules:
 *       - host: api.trinity.example.com
 *         paths:
 *           - path: /
 *             pathType: Prefix
 *             serviceName: trinity-gateway
 *             servicePort: 3000
 *     tls:
 *       - hosts: [api.trinity.example.com]
 *         secretName: trinity-gateway-tls
 */
export class KubernetesIngressRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8sing';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        return [...captureCommands, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesIngressRender.isKubernetesIngressResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesIngress resource`);
        }

        const config = resource.config as KubernetesIngressConfig;
        const ingressName = resource.name;

        // Build annotations
        const annotations: Record<string, string> = { ...(config.annotations ?? {}) };
        if (config.clusterIssuer) {
            annotations['cert-manager.io/cluster-issuer'] = config.clusterIssuer;
        }

        // Build spec
        const spec: Record<string, unknown> = {};

        if (config.ingressClassName) {
            spec.ingressClassName = config.ingressClassName;
        }

        if (config.tls && config.tls.length > 0) {
            spec.tls = config.tls.map(t => ({
                hosts: t.hosts,
                secretName: t.secretName,
            }));
        }

        spec.rules = config.rules.map(rule => ({
            host: rule.host,
            http: {
                paths: rule.paths.map(p => ({
                    path: p.path,
                    pathType: p.pathType ?? 'Prefix',
                    backend: {
                        service: {
                            name: p.serviceName,
                            port: { number: p.servicePort },
                        },
                    },
                })),
            },
        }));

        const manifest = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
                name: ingressName,
                namespace: config.namespace,
                ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
                ...(config.labels ? { labels: config.labels } : {}),
            },
            spec,
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', '__MERLIN_YAML_FILE__'],
            fileContent,
        }];
    }

    private static isKubernetesIngressResource(resource: Resource): resource is KubernetesIngressResource {
        return resource.type === KUBERNETES_INGRESS_TYPE;
    }
}
