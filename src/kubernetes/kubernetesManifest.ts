import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';
import { ensureNamespaceCommand } from './kubernetesNamespace.js';
import { MERLIN_YAML_FILE_PLACEHOLDER } from '../common/constants.js';

export const KUBERNETES_MANIFEST_TYPE = 'KubernetesManifest';

export interface KubernetesManifestConfig extends ResourceSchema {
    /**
     * Raw Kubernetes manifest YAML content.
     * Supports multi-document YAML (separated by ---).
     * ${ } expressions in the content are resolved before applying.
     */
    manifest: string;
}

export interface KubernetesManifestResource extends Resource<KubernetesManifestConfig> {}

/**
 * Cloud-agnostic KubernetesManifest render.
 *
 * Applies an arbitrary Kubernetes manifest via `kubectl apply -f`.
 * Use this for resources that don't have a dedicated merlin type:
 *   - ClusterIssuer (cert-manager)
 *   - HorizontalPodAutoscaler
 *   - ConfigMap / Secret
 *   - Custom CRD instances
 *
 * Example YAML usage:
 *   type: KubernetesManifest
 *   defaultConfig:
 *     manifest: |
 *       apiVersion: cert-manager.io/v1
 *       kind: ClusterIssuer
 *       metadata:
 *         name: letsencrypt-prod
 *       spec:
 *         acme:
 *           server: https://acme-v02.api.letsencrypt.org/directory
 *           email: ops@example.com
 *           privateKeySecretRef:
 *             name: letsencrypt-prod
 *           solvers:
 *             - http01:
 *                 ingress:
 *                   class: nginx
 */
export class KubernetesManifestRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8smf';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        // Extract namespace from config.namespace or from raw manifest content
        const config = resolved.config as Record<string, unknown>;
        const ns = (config.namespace as string | undefined)
            ?? KubernetesManifestRender.extractNamespaceFromManifest(config.manifest as string);
        const nsCmd = ns ? [ensureNamespaceCommand(ns)] : [];
        return [...captureCommands, ...nsCmd, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesManifestRender.isKubernetesManifestResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesManifest resource`);
        }

        const config = resource.config as KubernetesManifestConfig;

        return [{
            command: 'kubectl',
            args: ['apply', '-f', MERLIN_YAML_FILE_PLACEHOLDER],
            fileContent: config.manifest,
        }];
    }

    private static isKubernetesManifestResource(resource: Resource): resource is KubernetesManifestResource {
        return resource.type === KUBERNETES_MANIFEST_TYPE;
    }

    /**
     * Extract namespace from raw manifest YAML content.
     * Looks for `namespace: <value>` under `metadata:`.
     * Returns undefined if not found (e.g. cluster-scoped resources like ClusterIssuer).
     */
    private static extractNamespaceFromManifest(manifest: string | undefined): string | undefined {
        if (!manifest) return undefined;
        // Match `namespace: <value>` that appears after `metadata:` block
        const match = manifest.match(/\bnamespace:\s*(\S+)/);
        return match?.[1];
    }
}
