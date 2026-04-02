import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { manifestToYaml, ensureNamespaceCommand } from './kubernetesNamespace.js';
import { MERLIN_YAML_FILE_PLACEHOLDER } from '../common/constants.js';

export const KUBERNETES_SERVICE_ACCOUNT_TYPE = 'KubernetesServiceAccount';

export interface KubernetesServiceAccountConfig extends ResourceSchema {
    /** Kubernetes namespace */
    namespace: string;
    /** Annotations (e.g. azure.workload.identity/client-id) */
    annotations?: Record<string, string>;
    /** Additional labels */
    labels?: Record<string, string>;
}

export interface KubernetesServiceAccountResource extends Resource<KubernetesServiceAccountConfig> {}

/**
 * Cloud-agnostic KubernetesServiceAccount render.
 *
 * Generates a kubectl apply command with a ServiceAccount manifest.
 * ServiceAccount name is: <resource.name>
 *
 * Used for Workload Identity integration — annotate with:
 *   azure.workload.identity/client-id: <managed-identity-client-id>
 */
export class KubernetesServiceAccountRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8ssa';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        const ns = (resolved.config as Record<string, unknown>)?.namespace as string | undefined;
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesServiceAccountRender.isKubernetesServiceAccountResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesServiceAccount resource`);
        }

        const config = resource.config as KubernetesServiceAccountConfig;
        const saName = resource.name;

        const manifest = {
            apiVersion: 'v1',
            kind: 'ServiceAccount',
            metadata: {
                name: saName,
                namespace: config.namespace,
                ...(config.labels ? { labels: config.labels } : {}),
                ...(config.annotations ? { annotations: config.annotations } : {}),
            },
        };

        const fileContent = manifestToYaml(manifest);

        return [{
            command: 'kubectl',
            args: ['apply', '-f', MERLIN_YAML_FILE_PLACEHOLDER],
            fileContent,
        }];
    }

    private static isKubernetesServiceAccountResource(resource: Resource): resource is KubernetesServiceAccountResource {
        return resource.type === KUBERNETES_SERVICE_ACCOUNT_TYPE;
    }
}
