import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { RING_SHORT_NAME_MAP, REGION_SHORT_NAME_MAP } from '../common/resource.js';
import { isResourceNotFoundError, execAsync } from '../common/constants.js';

export const AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE = 'AzureServicePrincipal';

// refer to:
//   https://learn.microsoft.com/en-us/cli/azure/ad/sp
//   https://learn.microsoft.com/en-us/cli/azure/ad/app/federated-credential

export interface FederatedCredential {
    /** Unique name for this credential (must be unique within the App Registration) */
    name: string;
    /**
     * OIDC subject claim, e.g.
     *   repo:Org/Repo:environment:production
     *   repo:Org/Repo:ref:refs/heads/main
     */
    subject: string;
    /** Token issuer URL — defaults to GitHub Actions OIDC issuer */
    issuer?: string;
    /** Human-readable description (optional) */
    description?: string;
}

export interface RoleAssignment {
    /**
     * Azure RBAC role name, e.g. "Contributor", "AcrPush", "Storage Blob Data Contributor"
     */
    role: string;
    /**
     * ARM scope for the role assignment.
     * Use the literal placeholder `{subscriptionId}` (without `${ }`) to refer to the
     * current subscription; it will be resolved to a shell variable at deploy time.
     *
     * Example:
     *   /subscriptions/{subscriptionId}/resourceGroups/my-rg
     */
    scope: string;
}

/**
 * Well-known Azure AD directory role template IDs.
 * These are the same across all Azure AD tenants.
 * @see https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference
 */
export const DIRECTORY_ROLE_TEMPLATE_IDS: Record<string, string> = {
    'Directory Readers': '88d8e3e3-8f55-4a1e-953a-9b9898b8876b',
    'Directory Writers': '9360feb5-f418-4baa-8175-e2a00bac4301',
    'Application Administrator': '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3',
    'Cloud Application Administrator': '158c047a-c907-4556-b7ef-446551a6b5f7',
    'Global Reader': 'f2ef992c-3afb-46b9-b7cf-a126ee74c451',
    'Security Reader': '5d6b6bb7-de71-4623-b4af-96380a352509',
};

export interface ClientSecretKeyVault {
    /** Key Vault names to store the client secret in (supports multiple for multi-region) */
    vaultNames: string[];
    /** Secret name in Key Vault (e.g. "oauth2-proxy-client-secret") */
    secretName: string;
}

export interface ApiPermission {
    /**
     * The resource (API) application ID.
     * Well-known IDs:
     *   - Microsoft Graph: "00000003-0000-0000-c000-000000000000"
     */
    resourceAppId: string;
    /**
     * List of permission entries on this resource.
     * Each entry has an `id` (the permission GUID) and a `type`:
     *   - "Scope"  = delegated permission (user context)
     *   - "Role"   = application permission (app context)
     *
     * Common Microsoft Graph permission IDs:
     *   - User.Read (delegated): "e1fe6dd8-ba31-4d61-89e7-88639da4683d"
     *   - openid (delegated):    "37f7f235-527c-4136-accd-4a02d197296e"
     *   - profile (delegated):   "14dad69e-099b-42c9-810b-d002981feec1"
     *   - email (delegated):     "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0"
     */
    resourceAccess: { id: string; type: 'Scope' | 'Role' }[];
}

export interface CookieSecretKeyVault {
    /** Key Vault names to store the cookie secret in (supports multiple for multi-region) */
    vaultNames: string[];
    /** Secret name in Key Vault (e.g. "alluneed-oauth2-proxy-cookie-secret") */
    secretName: string;
}

// ── Well-known constants ─────────────────────────────────────────────────────

/** Microsoft Graph API application ID (same across all Azure AD tenants) */
export const MICROSOFT_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

/**
 * Standard OIDC delegated permissions for Microsoft Graph.
 * Includes: User.Read, email, profile, openid
 * Used as the default when `apiPermissions: 'oidc'` is set.
 */
export const DEFAULT_OIDC_API_PERMISSIONS: ApiPermission[] = [
    {
        resourceAppId: MICROSOFT_GRAPH_APP_ID,
        resourceAccess: [
            { id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' }, // User.Read
            { id: '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0', type: 'Scope' }, // email
            { id: '14dad69e-099b-42c9-810b-d002981feec1', type: 'Scope' }, // profile
            { id: '37f7f235-527c-4136-accd-4a02d197296e', type: 'Scope' }, // openid
        ],
    },
];

export interface AzureServicePrincipalConfig extends ResourceSchema {
    /**
     * Display name for the underlying AD App Registration.
     * If omitted, auto-generated as `[project-]<name>[-ring]`.
     */
    displayName?: string;

    /** Web platform redirect URIs for OAuth2/OIDC callback */
    webRedirectUris?: string[];

    /**
     * Auto-generate a client secret and store it in Azure Key Vault.
     * Only runs on create — does NOT rotate on update (to avoid breaking running services).
     */
    clientSecretKeyVault?: ClientSecretKeyVault;

    /**
     * Auto-generate a random cookie secret (for oauth2-proxy) and store in Key Vault.
     * Idempotent: only creates if the secret doesn't already exist in the first vault.
     * Runs on both create and update (unlike clientSecret which is create-only).
     */
    cookieSecretKeyVault?: CookieSecretKeyVault;

    /**
     * Require user/group assignment before they can sign in.
     * When true, only users/groups explicitly assigned to the Enterprise Application can log in.
     * Default: false (any user in the tenant can sign in).
     */
    assignmentRequired?: boolean;

    /**
     * API permissions (requiredResourceAccess) for the AD App Registration.
     * These are the permissions the app requests when users sign in.
     * Equivalent to Azure Portal → App registrations → API permissions.
     *
     * Can be:
     *   - `'oidc'`  — shorthand for standard OIDC permissions (User.Read + openid + profile + email)
     *   - Custom array of ApiPermission objects for fine-grained control
     *   - Omitted — no permissions are set
     *
     * Note: After setting permissions, an admin must still grant admin consent
     * (either via Portal or `az ad app permission admin-consent`).
     */
    apiPermissions?: 'oidc' | ApiPermission[];

    /** Federated credentials (OIDC trust relationships, e.g. GitHub Actions) */
    federatedCredentials?: FederatedCredential[];

    /** Role assignments granted to the Service Principal */
    roleAssignments?: RoleAssignment[];

    /**
     * Azure AD directory roles to assign to the Service Principal.
     * These are tenant-level roles (e.g. "Directory Readers") that grant
     * MS Graph API permissions — separate from ARM RBAC role assignments.
     *
     * Use well-known role names from `DIRECTORY_ROLE_TEMPLATE_IDS`, e.g.:
     *   - "Directory Readers" — read AD apps, SPs, users (needed for `az ad app list`)
     *   - "Cloud Application Administrator" — manage app registrations
     *
     * ⚠️ Requires Global Administrator or Privileged Role Administrator to deploy.
     */
    directoryRoles?: string[];
}

export interface AzureServicePrincipalResource extends Resource<AzureServicePrincipalConfig> {}

export class AzureServicePrincipalRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = true;

    /**
     * Service Principals are tenant-scoped global resources — they have no region.
     */
    override isGlobalResource: boolean = true;

    override getShortResourceTypeName(): string {
        return 'sp';
    }

    /**
     * SP names are global — no region component.
     * Pattern: [project-|shared-]<name>[-ring]
     */
    override getResourceName(resource: Resource): string {
        const projectPart = resource.project ? resource.project : 'shared';
        const ringPart = RING_SHORT_NAME_MAP[resource.ring] || resource.ring;
        return [projectPart, resource.name, ringPart].filter(Boolean).join('-');
    }

    /**
     * Returns the AD App display name.
     * Uses config.displayName if set, otherwise falls back to getResourceName().
     *
     * NOTE: unlike getResourceName() which uses short ring names (tst/stg),
     * displayName should use the full ring name if set explicitly in config.
     */
    getDisplayName(resource: AzureServicePrincipalResource): string {
        return resource.config.displayName ?? this.getResourceName(resource);
    }

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!AzureServicePrincipalRender.isAzureServicePrincipalResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an AzureServicePrincipal resource`);
        }

        const sp = resource as AzureServicePrincipalResource;
        const deployed = await this.getDeployedAppId(sp);

        if (!deployed) {
            return this.renderCreate(sp);
        } else {
            return this.renderUpdate(sp, deployed.appId, deployed.objectId);
        }
    }

    private static isAzureServicePrincipalResource(resource: Resource): resource is AzureServicePrincipalResource {
        return resource.type === AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE;
    }

    // ── Lookup ────────────────────────────────────────────────────────────────

    private async getDeployedAppId(
        resource: AzureServicePrincipalResource
    ): Promise<{ appId: string; objectId: string } | undefined> {
        const displayName = this.getDisplayName(resource);
        try {
            const result = await execAsync('az', ['ad', 'app', 'list', '--filter', `displayName eq '${displayName}'`, '--output', 'json']);
            const apps = JSON.parse(result);
            if (!Array.isArray(apps) || apps.length === 0) return undefined;
            return { appId: apps[0].appId as string, objectId: apps[0].id as string };
        } catch (error: any) {
            if (isResourceNotFoundError(error)) return undefined;
            throw new Error(`Failed to look up AD App '${displayName}': ${error}`);
        }
    }

    // ── Full create flow ──────────────────────────────────────────────────────

    renderCreate(resource: AzureServicePrincipalResource): Command[] {
        const commands: Command[] = [];

        // 1. Create AD App Registration
        const createArgs = ['ad', 'app', 'create', '--display-name', this.getDisplayName(resource)];
        const redirectUris = resource.config.webRedirectUris ?? [];
        if (redirectUris.length > 0) {
            createArgs.push('--web-redirect-uris', ...redirectUris);
        }
        commands.push({ command: 'az', args: createArgs });

        // 2. Capture the new appId
        const appIdVar = this.envVarName(resource, 'APP_ID');
        commands.push({
            command: 'az',
            args: ['ad', 'app', 'list', '--filter', `displayName eq '${this.getDisplayName(resource)}'`, '--query', '[0].appId', '-o', 'tsv'],
            envCapture: appIdVar,
        });

        // 3. Create Service Principal from App
        commands.push({
            command: 'az',
            args: ['ad', 'sp', 'create', '--id', `$${appIdVar}`],
        });

        // 4. API permissions (requiredResourceAccess)
        commands.push(...this.renderApiPermissions(resource, appIdVar));

        // 5. Configure assignment required (access control)
        commands.push(...this.renderAssignmentRequired(resource, appIdVar));

        // 5. Client secret → Key Vault (create-only, not on update to avoid breaking running services)
        commands.push(...this.renderClientSecret(resource, appIdVar));

        // 6. Cookie secret → Key Vault (idempotent — only creates if missing)
        commands.push(...this.renderCookieSecret(resource));

        // 7. Federated credentials
        commands.push(...this.renderFederatedCredentials(resource, appIdVar));

        // 8. Role assignments
        commands.push(...this.renderRoleAssignments(resource, appIdVar));

        // 9. Directory roles (tenant-level, e.g. Directory Readers)
        commands.push(...this.renderDirectoryRoles(resource, appIdVar));

        return commands;
    }

    // ── Update flow (federated credentials + role assignments only) ───────────

    renderUpdate(resource: AzureServicePrincipalResource, _appId: string, _objectId: string): Command[] {
        // Capture appId at deploy time (SP already exists)
        const appIdVar = this.envVarName(resource, 'APP_ID');
        const commands: Command[] = [];

        commands.push({
            command: 'az',
            args: ['ad', 'app', 'list', '--filter', `displayName eq '${this.getDisplayName(resource)}'`, '--query', '[0].appId', '-o', 'tsv'],
            envCapture: appIdVar,
        });

        // Ensure the Service Principal exists (App may exist without SP if a previous
        // create was interrupted, or if the App was created manually/via Portal)
        commands.push({
            command: 'bash',
            args: ['-c', `az ad sp create --id $${appIdVar} 2>/dev/null || true`],
        });

        // Update redirect URIs (idempotent — always sets the full list)
        const redirectUris = resource.config.webRedirectUris ?? [];
        if (redirectUris.length > 0) {
            commands.push({
                command: 'az',
                args: ['ad', 'app', 'update', '--id', `$${appIdVar}`, '--web-redirect-uris', ...redirectUris],
            });
        }

        // Update assignment required setting
        commands.push(...this.renderAssignmentRequired(resource, appIdVar));

        // Update API permissions (idempotent — always sets the full list)
        commands.push(...this.renderApiPermissions(resource, appIdVar));

        // Cookie secret → Key Vault (idempotent — only creates if missing)
        commands.push(...this.renderCookieSecret(resource));

        commands.push(...this.renderFederatedCredentials(resource, appIdVar));
        commands.push(...this.renderRoleAssignments(resource, appIdVar));

        // Directory roles (tenant-level, e.g. Directory Readers)
        commands.push(...this.renderDirectoryRoles(resource, appIdVar));

        return commands;
    }

    // ── Directory roles (tenant-level) ───────────────────────────────────────

    /**
     * Assign Azure AD directory roles (e.g. "Directory Readers") to the SP.
     * Uses MS Graph REST API via `az rest`.
     *
     * Steps per role:
     * 1. Activate the directory role template (idempotent — already-active is OK)
     * 2. Get the activated role's object ID
     * 3. Get the SP's object ID
     * 4. Add the SP as a member of the directory role (idempotent)
     *
     * ⚠️ Requires Global Administrator or Privileged Role Administrator.
     */
    renderDirectoryRoles(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const roles = resource.config.directoryRoles ?? [];
        if (roles.length === 0) return [];

        const commands: Command[] = [];

        // Capture the SP's object ID (we need the SP object, not the app object)
        const spObjectIdVar = this.envVarName(resource, 'SP_OID');
        commands.push({
            command: 'az',
            args: ['ad', 'sp', 'list', '--filter', `appId eq '$${appIdVar}'`, '--query', '[0].id', '-o', 'tsv'],
            envCapture: spObjectIdVar,
        });

        for (const roleName of roles) {
            const templateId = DIRECTORY_ROLE_TEMPLATE_IDS[roleName];
            if (!templateId) {
                throw new Error(
                    `Unknown directory role "${roleName}". Known roles: ${Object.keys(DIRECTORY_ROLE_TEMPLATE_IDS).join(', ')}`
                );
            }

            // Single bash script that:
            // 1. Activates the role template (POST directoryRoles, ignore "already exists")
            // 2. Gets the activated role's object ID
            // 3. Adds the SP as a member (ignore "already exists")
            const script = [
                `# Activate directory role template: ${roleName}`,
                `az rest --method post --url "https://graph.microsoft.com/v1.0/directoryRoles" ` +
                    `--headers "Content-Type=application/json" ` +
                    `--body '{"roleTemplateId":"${templateId}"}' 2>/dev/null || true`,
                ``,
                `# Get the activated role object ID`,
                `ROLE_ID=$(az rest --method get --url "https://graph.microsoft.com/v1.0/directoryRoles" ` +
                    `-o tsv --query "value[?roleTemplateId=='${templateId}'].id | [0]")`,
                ``,
                `# Add SP as member (idempotent — ignore "already exists")`,
                `az rest --method post ` +
                    `--url "https://graph.microsoft.com/v1.0/directoryRoles/$ROLE_ID/members/\\$ref" ` +
                    `--headers "Content-Type=application/json" ` +
                    `--body '{"@odata.id":"https://graph.microsoft.com/v1.0/servicePrincipals/'$${spObjectIdVar}'"}' 2>/dev/null || true`,
            ].join('\n');

            commands.push({
                command: 'bash',
                args: ['-c', script],
            });
        }

        return commands;
    }

    // ── API permissions (requiredResourceAccess) ─────────────────────────

    renderApiPermissions(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const raw = resource.config.apiPermissions;
        if (!raw) return [];

        // Resolve 'oidc' shorthand to the standard OIDC permission set
        const permissions: ApiPermission[] = raw === 'oidc' ? DEFAULT_OIDC_API_PERMISSIONS : raw;
        if (permissions.length === 0) return [];

        // az ad app update --required-resource-accesses expects a JSON array
        const payload = JSON.stringify(permissions.map(p => ({
            resourceAppId: p.resourceAppId,
            resourceAccess: p.resourceAccess,
        })));

        return [
            {
                command: 'az',
                args: ['ad', 'app', 'update', '--id', `$${appIdVar}`, '--required-resource-accesses', payload],
            },
            // Auto-grant admin consent (mimics what Azure Portal does on manual creation)
            {
                command: 'bash',
                args: ['-c', `az ad app permission admin-consent --id $${appIdVar} || true`],
            },
        ];
    }

    // ── Assignment required (access control) ─────────────────────────────

    renderAssignmentRequired(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        if (resource.config.assignmentRequired === undefined) return [];

        const spObjectIdVar = this.envVarName(resource, 'SP_OBJECT_ID');
        const value = resource.config.assignmentRequired ? 'true' : 'false';
        return [
            // Capture the SP's object ID — use `az ad sp show` (direct lookup by appId)
            // which is more reliable than `az ad sp list --filter` after a recent create.
            // If the SP doesn't exist yet, create it first.
            {
                command: 'bash',
                args: ['-c', `az ad sp show --id $${appIdVar} --query id -o tsv 2>/dev/null || az ad sp create --id $${appIdVar} --query id -o tsv`],
                envCapture: spObjectIdVar,
            },
            // Set appRoleAssignmentRequired on the Service Principal
            {
                command: 'az',
                args: ['ad', 'sp', 'update', '--id', `$${spObjectIdVar}`, '--set', `appRoleAssignmentRequired=${value}`],
            },
        ];
    }

    // ── Client secret → Key Vault ─────────────────────────────────────────

    renderClientSecret(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const kvConfig = resource.config.clientSecretKeyVault;
        if (!kvConfig) return [];

        const secretVar = this.envVarName(resource, 'CLIENT_SECRET');
        const commands: Command[] = [
            // Generate a new client secret and capture its value
            {
                command: 'az',
                args: ['ad', 'app', 'credential', 'reset', '--id', `$${appIdVar}`, '--query', 'password', '-o', 'tsv'],
                envCapture: secretVar,
            },
        ];

        // Store it in every Key Vault (for multi-region setups)
        for (const vaultName of kvConfig.vaultNames) {
            commands.push({
                command: 'az',
                args: ['keyvault', 'secret', 'set', '--vault-name', vaultName, '--name', kvConfig.secretName, '--value', `$${secretVar}`],
            });
        }

        return commands;
    }

    // ── Cookie secret → Key Vault (idempotent) ─────────────────────────────

    /**
     * Generate a random cookie secret (for oauth2-proxy) and store it in Key Vault.
     * Idempotent: checks the first vault — if the secret already exists, reuses it.
     * Generates once and stores in all vaults to ensure multi-region consistency.
     */
    renderCookieSecret(resource: AzureServicePrincipalResource): Command[] {
        const kvConfig = resource.config.cookieSecretKeyVault;
        if (!kvConfig) return [];

        const cookieVar = this.envVarName(resource, 'COOKIE_SECRET');
        const commands: Command[] = [
            // Check if cookie secret already exists in first vault; if not, generate new one
            {
                command: 'bash',
                args: ['-c', [
                    `EXISTING=$(az keyvault secret show --vault-name ${kvConfig.vaultNames[0]} --name ${kvConfig.secretName} --query value -o tsv 2>/dev/null || true)`,
                    `if [ -n "$EXISTING" ]; then echo "$EXISTING"; else openssl rand -hex 16; fi`,
                ].join('\n')],
                envCapture: cookieVar,
            },
        ];

        // Store in every Key Vault (idempotent — overwrites with same value if exists)
        for (const vaultName of kvConfig.vaultNames) {
            commands.push({
                command: 'az',
                args: ['keyvault', 'secret', 'set', '--vault-name', vaultName,
                       '--name', kvConfig.secretName, '--value', `$${cookieVar}`],
            });
        }

        return commands;
    }

    // ── Federated credentials ─────────────────────────────────────────────────

    renderFederatedCredentials(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const creds = resource.config.federatedCredentials ?? [];
        return creds.map(cred => {
            const params = JSON.stringify({
                name: cred.name,
                issuer: cred.issuer ?? 'https://token.actions.githubusercontent.com',
                subject: cred.subject,
                description: cred.description ?? '',
                audiences: ['api://AzureADTokenExchange'],
            });
            // Idempotent: try update first (credential exists), fall back to create
            return {
                command: 'bash',
                args: [
                    '-c',
                    `az ad app federated-credential update --id $${appIdVar} --federated-credential-id ${cred.name} --parameters '${params}' || az ad app federated-credential create --id $${appIdVar} --parameters '${params}'`,
                ],
            };
        });
    }

    // ── Role assignments ──────────────────────────────────────────────────────

    renderRoleAssignments(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const assignments = resource.config.roleAssignments ?? [];
        if (assignments.length === 0) return [];

        const commands: Command[] = [];

        // Capture subscription ID once (needed to resolve {subscriptionId} placeholder)
        const subscriptionIdVar = this.envVarName(resource, 'SUBSCRIPTION_ID');
        commands.push({
            command: 'az',
            args: ['account', 'show', '--query', 'id', '-o', 'tsv'],
            envCapture: subscriptionIdVar,
        });

        for (const ra of assignments) {
            // Replace {subscriptionId} placeholder with the captured shell variable
            const scope = ra.scope.replace(
                /\{subscriptionId\}/g,
                `$${subscriptionIdVar}`,
            );

            commands.push({
                command: 'bash',
                args: [
                    '-c',
                    `az role assignment create --assignee $${appIdVar} --role '${ra.role}' --scope '${scope}' || true`,
                ],
            });
        }

        return commands;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Build a unique shell environment variable name for this resource + suffix.
     * Pattern: MERLIN_SP_<PROJECT>_<NAME>_<RING>[_<REGION>]_<SUFFIX>
     */
    private envVarName(resource: AzureServicePrincipalResource, suffix: string): string {
        const parts = ['MERLIN', 'SP'];
        if (resource.project) parts.push(resource.project.toUpperCase().replace(/-/g, '_'));
        parts.push(resource.name.toUpperCase().replace(/-/g, '_'));
        parts.push((RING_SHORT_NAME_MAP[resource.ring] || resource.ring).toUpperCase());
        if (resource.region) {
            parts.push((REGION_SHORT_NAME_MAP[resource.region] || resource.region).toUpperCase());
        }
        parts.push(suffix);
        return parts.join('_');
    }
}
