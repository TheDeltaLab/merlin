import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';
import { resolveConfig } from '../common/paramResolver.js';

export const KUBERNETES_HELM_RELEASE_TYPE = 'KubernetesHelmRelease';

export interface HelmSetValue {
    /** The Helm value key, e.g. "controller.replicaCount" */
    key: string;
    /** The value, e.g. "2" */
    value: string;
}

export interface KubernetesHelmReleaseConfig extends ResourceSchema {
    /** Helm release name, e.g. "ingress-nginx" */
    releaseName: string;
    /** Helm chart reference, e.g. "ingress-nginx/ingress-nginx" */
    chart: string;
    /** Helm repo name, e.g. "ingress-nginx" */
    repoName: string;
    /** Helm repo URL, e.g. "https://kubernetes.github.io/ingress-nginx" */
    repoUrl: string;
    /** Kubernetes namespace to install into */
    namespace: string;
    /** Create namespace if it doesn't exist */
    createNamespace?: boolean;
    /** Chart version, e.g. "4.10.0". Omit for latest. */
    version?: string;
    /** --set key=value pairs */
    set?: HelmSetValue[];
    /** --set-string key=value pairs (forces string type) */
    setString?: HelmSetValue[];
    /** Wait for all resources to be ready before returning */
    wait?: boolean;
    /** Timeout for --wait, e.g. "5m0s" */
    timeout?: string;
    /**
     * Shell commands to run before helm upgrade --install.
     * Useful for workarounds like deleting conflicting webhooks.
     * Each command is wrapped in `bash -c '... || true'` to be idempotent.
     */
    preCommands?: string[];
}

export interface KubernetesHelmReleaseResource extends Resource<KubernetesHelmReleaseConfig> {}

/**
 * Cloud-agnostic KubernetesHelmRelease render.
 *
 * Generates:
 *   helm repo add <repoName> <repoUrl>
 *   helm repo update
 *   helm upgrade --install <releaseName> <chart> \
 *     --namespace <namespace> [--create-namespace] \
 *     [--version <version>] [--set key=value ...] [--wait]
 *
 * Uses `helm upgrade --install` which is idempotent:
 *   - First run: installs the release
 *   - Subsequent runs: upgrades to the latest config/version
 *
 * Assumes helm is installed on the deploy machine and kubectl is
 * configured (kubeconfig points to the correct cluster).
 */
export class KubernetesHelmReleaseRender implements Render {
    isGlobalResource = false;

    getShortResourceTypeName(): string {
        return 'k8shelm';
    }

    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        return [...captureCommands, ...renderCommands];
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!KubernetesHelmReleaseRender.isHelmReleaseResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesHelmRelease resource`);
        }

        const config = resource.config as KubernetesHelmReleaseConfig;
        const commands: Command[] = [];

        // Step 1: add helm repo
        commands.push({
            command: 'helm',
            args: ['repo', 'add', config.repoName, config.repoUrl],
        });

        // Step 2: update repos
        commands.push({
            command: 'helm',
            args: ['repo', 'update'],
        });

        // Step 2.5: run pre-commands (e.g. delete conflicting webhooks)
        if (config.preCommands && config.preCommands.length > 0) {
            for (const cmd of config.preCommands) {
                commands.push({
                    command: 'bash',
                    args: ['-c', `${cmd} || true`],
                });
            }
        }

        // Step 3: helm upgrade --install
        const args: string[] = [
            'upgrade', '--install',
            config.releaseName,
            config.chart,
            '--namespace', config.namespace,
        ];

        if (config.createNamespace !== false) {
            // default true
            args.push('--create-namespace');
        }

        if (config.version) {
            args.push('--version', config.version);
        }

        if (config.set && config.set.length > 0) {
            for (const s of config.set) {
                args.push('--set', `${s.key}=${s.value}`);
            }
        }

        if (config.setString && config.setString.length > 0) {
            for (const s of config.setString) {
                args.push('--set-string', `${s.key}=${s.value}`);
            }
        }

        if (config.wait === true) {
            args.push('--wait');
            if (config.timeout) {
                args.push('--timeout', config.timeout);
            }
        }

        commands.push({ command: 'helm', args });

        return commands;
    }

    private static isHelmReleaseResource(resource: Resource): resource is KubernetesHelmReleaseResource {
        return resource.type === KUBERNETES_HELM_RELEASE_TYPE;
    }
}
