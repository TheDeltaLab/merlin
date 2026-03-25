import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';

export const KUBERNETES_NAMESPACE_TYPE = 'KubernetesNamespace';

export interface KubernetesNamespaceConfig extends ResourceSchema {
    /** The namespace name. Defaults to resource.name if omitted. */
    namespaceName?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
}

export interface KubernetesNamespaceResource extends Resource<KubernetesNamespaceConfig> {}

/**
 * Cloud-agnostic KubernetesNamespace render.
 *
 * Generates:
 *   kubectl apply -f - <<EOF
 *   apiVersion: v1
 *   kind: Namespace
 *   metadata:
 *     name: <namespaceName>
 *     labels: ...
 *   EOF
 *
 * Idempotent: uses `kubectl apply` so re-runs are safe.
 * Assumes kubectl is already configured (run after KubernetesCluster which calls az aks get-credentials).
 */
export class KubernetesNamespaceRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8sns';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        return [...captureCommands, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesNamespaceRender.isKubernetesNamespaceResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesNamespace resource`);
        }

        const config = resource.config as KubernetesNamespaceConfig;
        const namespaceName = config.namespaceName ?? resource.name;

        const manifest: Record<string, unknown> = {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: namespaceName,
                ...(config.labels ? { labels: config.labels } : {}),
                ...(config.annotations ? { annotations: config.annotations } : {}),
            },
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', '__MERLIN_YAML_FILE__'],
            fileContent,
        }];
    }

    private static isKubernetesNamespaceResource(resource: Resource): resource is KubernetesNamespaceResource {
        return resource.type === KUBERNETES_NAMESPACE_TYPE;
    }
}

/**
 * Convert a plain JS object to a YAML string.
 * Uses a hand-rolled serializer to avoid adding a YAML library dependency
 * to this file specifically (merlin already has the `yaml` package available).
 */
export function manifestToYaml(obj: unknown, indent = 0): string {
    const spaces = '  '.repeat(indent);

    if (obj === null || obj === undefined) {
        return 'null';
    }

    if (typeof obj === 'boolean') {
        return obj ? 'true' : 'false';
    }

    if (typeof obj === 'number') {
        return String(obj);
    }

    if (typeof obj === 'string') {
        // Quote strings that could be misinterpreted
        if (obj === '' || /[:{}\[\],#&*?|<>=!%@`]/.test(obj) ||
            obj.includes('\n') || obj.includes("'") ||
            /^\s|\s$/.test(obj) || obj.toLowerCase() === 'true' ||
            obj.toLowerCase() === 'false' || obj.toLowerCase() === 'null') {
            return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        return obj.map(item => `${spaces}- ${manifestToYaml(item, indent + 1).trimStart()}`).join('\n');
    }

    if (typeof obj === 'object') {
        const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return '{}';

        return entries.map(([k, v]) => {
            const valueYaml = manifestToYaml(v, indent + 1);
            if (typeof v === 'object' && v !== null && !Array.isArray(v) &&
                Object.keys(v as object).length > 0) {
                return `${spaces}${k}:\n${valueYaml}`;
            }
            if (Array.isArray(v) && v.length > 0) {
                return `${spaces}${k}:\n${valueYaml}`;
            }
            return `${spaces}${k}: ${valueYaml}`;
        }).join('\n');
    }

    return String(obj);
}
