/**
 * Initialization module - registers all providers
 *
 * Reads MERLIN_CLOUD env variable (default: 'azure') to determine which
 * cloud provider implementations to register. Each cloud module exports
 * a registerProviders() function that handles all cloud-specific registrations
 * (renders, auth providers, property getters, pre-deploy provider).
 *
 * Cloud-neutral resources (GitHub, Kubernetes) are registered unconditionally.
 *
 * This module should be imported before any generated resources.
 */

import { registerRender } from './common/resource.js';

// ── Cloud provider registrations ─────────────────────────────────────────────
import { registerAzureProviders } from './azure/register.js';

// ── Cloud-neutral resource types ─────────────────────────────────────────────
import {
    KUBERNETES_NAMESPACE_TYPE,
    KUBERNETES_DEPLOYMENT_TYPE,
    KUBERNETES_SERVICE_TYPE,
    KUBERNETES_INGRESS_TYPE,
    KUBERNETES_HELM_RELEASE_TYPE,
    KUBERNETES_MANIFEST_TYPE,
    KUBERNETES_CONFIG_MAP_TYPE,
    KUBERNETES_SERVICE_ACCOUNT_TYPE,
} from './common/cloudTypes.js';
import { KubernetesNamespaceRender } from './kubernetes/kubernetesNamespace.js';
import { KubernetesDeploymentRender } from './kubernetes/kubernetesDeployment.js';
import { KubernetesServiceRender } from './kubernetes/kubernetesService.js';
import { KubernetesIngressRender } from './kubernetes/kubernetesIngress.js';
import { KubernetesHelmReleaseRender } from './kubernetes/kubernetesHelmRelease.js';
import { KubernetesManifestRender } from './kubernetes/kubernetesManifest.js';
import { KubernetesConfigMapRender } from './kubernetes/kubernetesConfigMap.js';
import { KubernetesServiceAccountRender } from './kubernetes/kubernetesServiceAccount.js';
import {
    GITHUB_WORKFLOW_RESOURCE_TYPE,
    GitHubWorkflowRender,
} from './github/githubWorkflow.js';

// ── Cloud selection ────────────────────────────────────────────────────────────

const cloud = (process.env.MERLIN_CLOUD ?? 'azure').toLowerCase();

if (cloud === 'azure') {
    registerAzureProviders();
} else if (cloud === 'alibaba') {
    throw new Error(
        'Alibaba Cloud provider is not yet implemented. ' +
        'Phase 2 implementation is in progress. ' +
        'See src/alibaba/ for the planned structure.'
    );
} else {
    throw new Error(
        `Unknown cloud provider: "${cloud}". Supported values: azure, alibaba`
    );
}

// ── Cloud-neutral resources ────────────────────────────────────────────────────
registerRender(GITHUB_WORKFLOW_RESOURCE_TYPE, new GitHubWorkflowRender());

// ── Cloud-neutral Kubernetes resources (use kubectl/helm, work on any cluster) ──
registerRender(KUBERNETES_NAMESPACE_TYPE,       new KubernetesNamespaceRender());
registerRender(KUBERNETES_DEPLOYMENT_TYPE,      new KubernetesDeploymentRender());
registerRender(KUBERNETES_SERVICE_TYPE,         new KubernetesServiceRender());
registerRender(KUBERNETES_INGRESS_TYPE,         new KubernetesIngressRender());
registerRender(KUBERNETES_HELM_RELEASE_TYPE,    new KubernetesHelmReleaseRender());
registerRender(KUBERNETES_MANIFEST_TYPE,        new KubernetesManifestRender());
registerRender(KUBERNETES_CONFIG_MAP_TYPE,      new KubernetesConfigMapRender());
registerRender(KUBERNETES_SERVICE_ACCOUNT_TYPE, new KubernetesServiceAccountRender());

export function initializeMerlin(): void {
    // Initialization happens during module load via the side-effects above.
    // This function exists for explicit initialization if needed.
}
