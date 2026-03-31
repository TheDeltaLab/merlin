import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml, ensureNamespaceCommand } from './kubernetesNamespace.js';

export const KUBERNETES_CONFIG_MAP_TYPE = 'KubernetesConfigMap';

export interface KubernetesConfigMapConfig extends ResourceSchema {
    /** Kubernetes namespace */
    namespace: string;
    /** ConfigMap data as key-value pairs */
    data: Record<string, string>;
    /** Additional labels */
    labels?: Record<string, string>;
    /** Annotations */
    annotations?: Record<string, string>;
}

export interface KubernetesConfigMapResource extends Resource<KubernetesConfigMapConfig> {}

/**
 * Cloud-agnostic KubernetesConfigMap render.
 *
 * Generates a kubectl apply command with a ConfigMap manifest.
 * ConfigMap name is: <resource.name>
 *
 * Supports ${ } parameter expressions in data values — they are resolved
 * by resolveConfig() before the manifest is generated.
 */
export class KubernetesConfigMapRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8scm';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        const ns = (resolved.config as Record<string, unknown>)?.namespace as string | undefined;
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesConfigMapRender.isKubernetesConfigMapResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesConfigMap resource`);
        }

        const config = resource.config as KubernetesConfigMapConfig;
        const configMapName = resource.name;

        // ConfigMap .data values MUST be strings — coerce any non-string values
        const stringData: Record<string, string> = {};
        for (const [k, v] of Object.entries(config.data)) {
            stringData[k] = String(v);
        }

        const manifest = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {
                name: configMapName,
                namespace: config.namespace,
                ...(config.labels ? { labels: config.labels } : {}),
                ...(config.annotations ? { annotations: config.annotations } : {}),
            },
            data: stringData,
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', '__MERLIN_YAML_FILE__'],
            fileContent,
        }];
    }

    private static isKubernetesConfigMapResource(resource: Resource): resource is KubernetesConfigMapResource {
        return resource.type === KUBERNETES_CONFIG_MAP_TYPE;
    }
}
