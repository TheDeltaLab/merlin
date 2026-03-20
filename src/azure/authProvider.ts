import { AuthProvider, Command, Dependency, Resource, getRender } from "../common/resource.js";
import { AzureResourceRender } from "./render.js";
import { AzureADAppRender, AzureADAppResource } from "./azureADApp.js";

/**
 * Supported role assignment scopes.
 *
 * - "resource": the role is assigned on the provider resource itself
 *               (e.g. AcrPull on a specific ACR)
 * - "resourceGroup": the role is assigned on the provider's resource group
 * - "subscription": the role is assigned at the subscription level
 */
export type RoleAssignmentScope = 'resource' | 'resourceGroup' | 'subscription';

/**
 * AzureManagedIdentityAuthProvider
 *
 * Grants a role on the *provider* resource to the managed identity of the *requestor* resource.
 *
 * Expected args (from YAML authProvider config):
 *   - role  (required): the Azure built-in or custom role name/id, e.g. "AcrPull"
 *   - scope (optional): "resource" | "resourceGroup" | "subscription" (default: "resource")
 *
 * At deploy time the commands:
 *   1. Fetch the requestor's system-assigned principal ID at runtime via envCapture.
 *   2. Fetch the provider's resource scope (ARM resource ID or RG) at runtime via envCapture.
 *   3. Run `az role assignment create` using both captured values.
 *
 * All lookups are deferred to shell commands so dry-run works even when
 * resources don't exist yet.
 */
export class AzureManagedIdentityAuthProvider implements AuthProvider {
    name: string = 'AzureManagedIdentity';

    dependencies: Dependency[] = [];

    async apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]> {
        const role = args['role'];
        if (!role) {
            throw new Error(
                `AzureManagedIdentityAuthProvider: 'role' is required in authProvider args ` +
                `(requestor: ${requestor.type}.${requestor.name}, provider: ${provider.type}.${provider.name})`
            );
        }

        const scopeMode: RoleAssignmentScope = (args['scope'] as RoleAssignmentScope) ?? 'resource';

        const requestorRender = getRender(requestor.type) as AzureResourceRender;
        const providerRender  = getRender(provider.type)  as AzureResourceRender;

        // Shell variable name slug helper (uppercase, non-alphanumeric → underscore)
        const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');

        const requestorSlug = slug(requestorRender.getResourceName(requestor));
        const providerSlug  = slug(providerRender.getResourceName(provider));
        const roleSlug      = slug(role);

        const principalVar = `MERLIN_MI_${requestorSlug}_PRINCIPAL_ID`;
        const scopeVar     = `MERLIN_MI_${providerSlug}_${roleSlug}_SCOPE`;

        const commands: Command[] = [];

        // ── Step 1: capture the requestor's managed identity principal ID ──────
        commands.push(
            ...this.buildPrincipalIdCapture(requestor, requestorRender, principalVar)
        );

        // ── Step 2: capture the provider resource's ARM scope ─────────────────
        commands.push(
            ...this.buildScopeCapture(provider, providerRender, scopeMode, scopeVar)
        );

        // ── Step 3: create the role assignment (idempotent) ───────────────────
        // --assignee-object-id + --assignee-principal-type avoids AAD graph lookups
        // and is more reliable in automation contexts.
        commands.push({
            command: 'az',
            args: [
                'role', 'assignment', 'create',
                '--assignee-object-id', `$${principalVar}`,
                '--assignee-principal-type', 'ServicePrincipal',
                '--role', role,
                '--scope', `$${scopeVar}`,
            ],
        });

        return commands;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Returns commands to capture the system-assigned managed identity principal ID
     * of the requestor resource into `varName`.
     *
     * Strategy: use `az resource show` with a JMESPath query that works across
     * resource types by fetching `identity.principalId`.  This is more reliable
     * than `az ad sp list --filter` because:
     *   - It requires no AAD Graph read permission.
     *   - It directly returns the object ID without a name-based search.
     *
     * If the resource type has a dedicated `show` command registered via a
     * known mapping we use that; otherwise we fall back to `az resource show`.
     */
    private buildPrincipalIdCapture(
        requestor: Resource,
        render: AzureResourceRender,
        varName: string,
    ): Command[] {
        const resourceName  = render.getResourceName(requestor);
        const resourceGroup = render.getResourceGroupName(requestor);

        const showArgs = this.buildShowArgs(requestor.type, resourceName, resourceGroup);

        return [{
            command: 'az',
            args: [...showArgs, '--query', 'identity.principalId', '-o', 'tsv'],
            envCapture: varName,
        }];
    }

    /**
     * Returns commands to capture the ARM scope string for the provider resource
     * into `varName`.  The scope depends on `scopeMode`:
     *
     * - "resource":      the full ARM resource ID of the provider
     * - "resourceGroup": the resource group ARM ID (/subscriptions/.../resourceGroups/...)
     * - "subscription":  the subscription ARM ID (/subscriptions/...)
     */
    private buildScopeCapture(
        provider: Resource,
        render: AzureResourceRender,
        scopeMode: RoleAssignmentScope,
        varName: string,
    ): Command[] {
        const resourceName  = render.getResourceName(provider);
        const resourceGroup = render.getResourceGroupName(provider);

        switch (scopeMode) {
            case 'resource': {
                // Full ARM resource ID via az <resource> show --query id
                const showArgs = this.buildShowArgs(provider.type, resourceName, resourceGroup);
                return [{
                    command: 'az',
                    args: [...showArgs, '--query', 'id', '-o', 'tsv'],
                    envCapture: varName,
                }];
            }

            case 'resourceGroup': {
                // Resource group ARM ID
                return [{
                    command: 'az',
                    args: [
                        'group', 'show',
                        '--name', resourceGroup,
                        '--query', 'id',
                        '-o', 'tsv',
                    ],
                    envCapture: varName,
                }];
            }

            case 'subscription': {
                // Subscription ARM ID
                return [{
                    command: 'az',
                    args: [
                        'account', 'show',
                        '--query', 'id',
                        '-o', 'tsv',
                    ],
                    envCapture: varName,
                }];
            }
        }
    }

    /**
     * Returns the `az` sub-command args (without --query/-o) for showing a
     * resource of the given type.  Falls back to `az resource show` for unknown
     * types so the auth provider works with any future resource type.
     */
    private buildShowArgs(resourceType: string, resourceName: string, resourceGroup: string): string[] {
        const SHOW_COMMAND_MAP: Record<string, string[]> = {
            'AzureContainerApp':         ['containerapp', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureContainerRegistry':    ['acr', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureContainerAppEnvironment': ['containerapp', 'env', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureLogAnalyticsWorkspace': ['monitor', 'log-analytics', 'workspace', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureBlobStorage':          ['storage', 'account', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureFunctionApp':          ['functionapp', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureKeyVault':             ['keyvault', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzureRedisEnterprise':      ['redisenterprise', 'show', '--name', resourceName, '--resource-group', resourceGroup],
            'AzurePostgreSQLFlexible':   ['postgres', 'flexible-server', 'show', '--name', resourceName, '--resource-group', resourceGroup],
        };

        return SHOW_COMMAND_MAP[resourceType] ?? [
            'resource', 'show',
            '--name', resourceName,
            '--resource-group', resourceGroup,
            '--resource-type', resourceType,
        ];
    }
}


export class AzureEntraIDAuthProvider implements AuthProvider {
    name: string = 'AzureEntraID';

    dependencies: Dependency[] = [];

    /**
     * Grants the requestor's managed identity an AAD App Role on the provider AAD App.
     *
     * Required args:
     *   - role: the app role value string (e.g. "Admin.Access")
     *
     * Generates:
     *   1. Capture the requestor's managed identity principal ID (service principal object ID)
     *   2. Capture the provider AAD App's appId
     *   3. Capture the provider AAD App's service principal object ID
     *   4. Capture the app role ID from the SP's appRoles
     *   5. POST to Graph API via az rest to create the app role assignment (idempotent via || true)
     */
    async apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]> {
        const role = args['role'];
        if (!role) {
            throw new Error(
                `AzureEntraIDAuthProvider: 'role' is required in authProvider args ` +
                `(requestor: ${requestor.type}.${requestor.name}, provider: ${provider.type}.${provider.name})`
            );
        }

        const requestorRender = getRender(requestor.type) as AzureResourceRender;
        const providerRender  = getRender(provider.type)  as AzureADAppRender;

        const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');

        const requestorSlug = slug(requestorRender.getResourceName(requestor));
        const providerSlug  = slug(providerRender.getResourceName(provider));
        const roleSlug      = slug(role);

        // Shell variable names
        const principalIdVar = `MERLIN_MI_${requestorSlug}_PRINCIPAL_ID`;
        const appIdVar       = `MERLIN_AAD_${providerSlug}_${roleSlug}_APPID`;
        const spObjectIdVar  = `MERLIN_AAD_${providerSlug}_${roleSlug}_SPOID`;
        const roleIdVar      = `MERLIN_AAD_${providerSlug}_${roleSlug}_ROLEID`;

        const commands: Command[] = [];

        // Step 1: capture requestor managed identity principal ID
        const requestorName = requestorRender.getResourceName(requestor);
        const requestorRg   = requestorRender.getResourceGroupName(requestor);
        commands.push({
            command: 'az',
            args: ['containerapp', 'show', '--name', requestorName, '--resource-group', requestorRg, '--query', 'identity.principalId', '-o', 'tsv'],
            envCapture: principalIdVar,
        });

        // Step 2: capture provider AAD App's appId
        const displayName = providerRender.getDisplayName(provider as AzureADAppResource);
        commands.push({
            command: 'az',
            args: ['ad', 'app', 'list', '--filter', `displayName eq '${displayName}'`, '--query', '[0].appId', '-o', 'tsv'],
            envCapture: appIdVar,
        });

        // Step 3: capture provider AAD App's service principal object ID
        commands.push({
            command: 'az',
            args: ['ad', 'sp', 'show', '--id', `$${appIdVar}`, '--query', 'id', '-o', 'tsv'],
            envCapture: spObjectIdVar,
        });

        // Step 4: capture the app role ID by role value
        commands.push({
            command: 'az',
            args: ['ad', 'sp', 'show', '--id', `$${appIdVar}`, '--query', `appRoles[?value=='${role}'].id | [0]`, '-o', 'tsv'],
            envCapture: roleIdVar,
        });

        // Step 5: assign the app role via Graph API (az rest) — idempotent via || true
        // az ad app role-assignment does not exist; the correct approach is Graph API POST
        const body = `{"principalId":"$${principalIdVar}","resourceId":"$${spObjectIdVar}","appRoleId":"$${roleIdVar}"}`;
        commands.push({
            command: 'bash',
            args: [
                '-c',
                `az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$${spObjectIdVar}/appRoleAssignments" --headers "Content-Type=application/json" --body '${body}' || true`,
            ],
        });

        return commands;
    }
}