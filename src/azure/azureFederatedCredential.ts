import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { RING_SHORT_NAME_MAP } from '../common/resource.js';
import { getResource } from '../common/registry.js';
import { getRender } from '../common/resource.js';
import {
    AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
    AzureServicePrincipalRender,
    AzureServicePrincipalResource,
} from './azureServicePrincipal.js';

/**
 * Resource type that lets each application self-manage its own federated
 * credentials (OIDC trust relationships) on a *shared* Service Principal
 * (e.g. `brainly-github-tst`, `brainly-kv-workload-tst`).
 *
 * Background:
 *   The shared SPs (`shared-resource/sharedgithubsp.yml`,
 *   `shared-k8s-resource/sharedkvsp.yml`) used to enumerate every
 *   application's GitHub repo / K8s ServiceAccount in their
 *   `federatedCredentials` arrays. That made the shared infra
 *   reverse-coupled to each downstream app — onboarding a new app required
 *   editing merlin, releasing a new version, and bumping the dep
 *   everywhere. With this resource type, each app declares ONE yaml in its
 *   own repo to register its OIDC subject against the shared SP.
 *
 * Tenant vs subscription:
 *   AD App / SP / federated credentials are *tenant-scoped* (Microsoft
 *   Graph), independent of the active ARM subscription. So this resource
 *   is `isGlobalResource: true` and works across rings/subscriptions.
 *
 * Idempotency:
 *   Mirrors the `update || create` pattern used in
 *   AzureServicePrincipalRender.renderFederatedCredentials() so applying
 *   the same yaml twice is a no-op.
 */

export const AZURE_FEDERATED_CREDENTIAL_RESOURCE_TYPE = 'AzureFederatedCredential';

/** GitHub Actions OIDC issuer — default for `issuer` when not specified. */
export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

export interface AzureFederatedCredentialConfig extends ResourceSchema {
    /**
     * The *resource name* (NOT the Azure displayName) of the target
     * AzureServicePrincipal that this credential will be attached to.
     *
     * The render looks the SP up via `getResource(AzureServicePrincipal,
     * <servicePrincipal>, <ring>)` so the same yaml can target different
     * concrete SPs in test vs staging vs production.
     *
     * Example: `github`, `kv-workload`.
     */
    servicePrincipal: string;

    /**
     * OIDC subject claim. Examples:
     *   - GitHub Actions:
     *       repo:TheDeltaLab/trinity:environment:test
     *       repo:TheDeltaLab/trinity:ref:refs/heads/main
     *   - K8s Workload Identity:
     *       system:serviceaccount:trinity:trinity-workload-sa
     */
    subject: string;

    /**
     * Token issuer URL. Defaults to GitHub Actions OIDC.
     * For K8s Workload Identity, set this to the AKS OIDC issuer URL —
     * typically `${ KubernetesCluster.aks.oidcIssuerUrl }`.
     */
    issuer?: string;

    /**
     * Name of the federated credential on the SP (must be unique per SP).
     * Defaults to `[<project>-]<name>`.
     */
    credentialName?: string;

    /** Free-form description (optional). */
    description?: string;
}

export interface AzureFederatedCredentialResource extends Resource<AzureFederatedCredentialConfig> {}

export class AzureFederatedCredentialRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = true;

    /**
     * Federated credentials live on AD Apps which are tenant-scoped — there
     * is no region.
     */
    override isGlobalResource: boolean = true;

    override getShortResourceTypeName(): string {
        return 'fedcred';
    }

    /**
     * Compute the federated credential's name on the SP.
     *
     *   <credentialName>            (if explicitly set)
     *   <project>-<resource.name>   (if project is set)
     *   <resource.name>             (otherwise)
     */
    getCredentialName(resource: AzureFederatedCredentialResource): string {
        if (resource.config.credentialName) return resource.config.credentialName;
        return [resource.project, resource.name].filter(Boolean).join('-');
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!AzureFederatedCredentialRender.isAzureFederatedCredentialResource(resource)) {
            throw new Error(
                `Resource ${resource.name} is not an AzureFederatedCredential resource`
            );
        }

        const fc = resource as AzureFederatedCredentialResource;

        // 1. Resolve target SP via registry. Global resource fall-through in
        //    getResource() means a regional caller can find a global SP by
        //    ring alone.
        const spName = fc.config.servicePrincipal;
        if (!spName || typeof spName !== 'string') {
            throw new Error(
                `AzureFederatedCredential ${fc.name}: 'servicePrincipal' is required and must be a string`
            );
        }
        const sp = getResource(AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE, spName, fc.ring) as
            | AzureServicePrincipalResource
            | undefined;
        if (!sp) {
            throw new Error(
                `AzureFederatedCredential ${fc.name}: target AzureServicePrincipal '${spName}' ` +
                    `not found in registry for ring '${fc.ring}'. ` +
                    `Make sure it is declared as a dependency: ` +
                    `'AzureServicePrincipal.${spName}'.`
            );
        }

        // 2. Use the SP render's getDisplayName() to compute the Azure AD
        //    App displayName (which may differ from the resource name).
        const spRender = getRender(AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE) as
            | AzureServicePrincipalRender
            | undefined;
        if (!spRender) {
            throw new Error(
                `AzureFederatedCredential ${fc.name}: AzureServicePrincipal render not registered`
            );
        }
        const displayName = spRender.getDisplayName(sp);

        // 3. Build the JSON parameters body — same shape as
        //    AzureServicePrincipalRender.renderFederatedCredentials().
        const credName = this.getCredentialName(fc);
        const params = JSON.stringify({
            name: credName,
            issuer: fc.config.issuer ?? GITHUB_ACTIONS_OIDC_ISSUER,
            subject: fc.config.subject,
            description: fc.config.description ?? '',
            audiences: ['api://AzureADTokenExchange'],
        });

        // 4. Capture the AD App's appId at deploy time (list-first; do NOT
        //    create the App — that is the SP's responsibility), then
        //    update-or-create the federated credential.
        const appIdVar = this.envVarName(fc, 'APP_ID');
        const captureScript = [
            `APP_ID=$(az ad app list --filter "displayName eq '${displayName}'" --query "[0].appId" -o tsv 2>/dev/null || true)`,
            `if [ -z "$APP_ID" ]; then`,
            `  echo "AzureFederatedCredential ${fc.name}: AD App '${displayName}' not found. ` +
                `Deploy the AzureServicePrincipal '${spName}' first." 1>&2`,
            `  exit 1`,
            `fi`,
            `echo "$APP_ID"`,
        ].join('\n');

        return [
            {
                command: 'bash',
                args: ['-c', captureScript],
                envCapture: appIdVar,
            },
            {
                command: 'bash',
                args: [
                    '-c',
                    `az ad app federated-credential update --id $${appIdVar} ` +
                        `--federated-credential-id ${credName} --parameters '${params}' || ` +
                        `az ad app federated-credential create --id $${appIdVar} ` +
                        `--parameters '${params}'`,
                ],
            },
        ];
    }

    private static isAzureFederatedCredentialResource(
        resource: Resource
    ): resource is AzureFederatedCredentialResource {
        return resource.type === AZURE_FEDERATED_CREDENTIAL_RESOURCE_TYPE;
    }

    /**
     * Build a unique shell environment variable name for this resource + suffix.
     * Pattern: MERLIN_FEDCRED_<PROJECT>_<NAME>_<RING>_<SUFFIX>
     */
    private envVarName(resource: AzureFederatedCredentialResource, suffix: string): string {
        const parts = ['MERLIN', 'FEDCRED'];
        if (resource.project) parts.push(resource.project.toUpperCase().replace(/-/g, '_'));
        parts.push(resource.name.toUpperCase().replace(/-/g, '_'));
        parts.push((RING_SHORT_NAME_MAP[resource.ring] || resource.ring).toUpperCase());
        parts.push(suffix);
        return parts.join('_');
    }
}
