import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { RING_SHORT_NAME_MAP, REGION_SHORT_NAME_MAP } from '../common/resource.js';
import { execSync } from 'child_process';

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

export interface AzureServicePrincipalConfig extends ResourceSchema {
    /**
     * Display name for the underlying AD App Registration.
     * If omitted, auto-generated as `[project-]<name>[-ring]`.
     */
    displayName?: string;

    /** Federated credentials (OIDC trust relationships, e.g. GitHub Actions) */
    federatedCredentials?: FederatedCredential[];

    /** Role assignments granted to the Service Principal */
    roleAssignments?: RoleAssignment[];
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
            const result = execSync(
                `az ad app list --filter "displayName eq '${displayName}'" --output json 2>/dev/null`,
                { encoding: 'utf-8' }
            );
            const apps = JSON.parse(result);
            if (!Array.isArray(apps) || apps.length === 0) return undefined;
            return { appId: apps[0].appId as string, objectId: apps[0].id as string };
        } catch (error: any) {
            if (error.status === 3 || error.status === 1) return undefined;
            const combined = (error.message || '') + ' ' + (error.stderr?.toString() || '');
            if (combined.includes('ResourceNotFound') || combined.includes('was not found')) return undefined;
            throw new Error(`Failed to look up AD App '${displayName}': ${error}`);
        }
    }

    // ── Full create flow ──────────────────────────────────────────────────────

    renderCreate(resource: AzureServicePrincipalResource): Command[] {
        const commands: Command[] = [];

        // 1. Create AD App Registration
        commands.push({
            command: 'az',
            args: ['ad', 'app', 'create', '--display-name', this.getDisplayName(resource)],
        });

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

        // 4. Federated credentials
        commands.push(...this.renderFederatedCredentials(resource, appIdVar));

        // 5. Role assignments
        commands.push(...this.renderRoleAssignments(resource, appIdVar));

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

        commands.push(...this.renderFederatedCredentials(resource, appIdVar));
        commands.push(...this.renderRoleAssignments(resource, appIdVar));

        return commands;
    }

    // ── Federated credentials ─────────────────────────────────────────────────

    renderFederatedCredentials(resource: AzureServicePrincipalResource, appIdVar: string): Command[] {
        const creds = resource.config.federatedCredentials ?? [];
        return creds.map(cred => ({
            command: 'az',
            args: [
                'ad', 'app', 'federated-credential', 'create',
                '--id', `$${appIdVar}`,
                '--parameters', JSON.stringify({
                    name: cred.name,
                    issuer: cred.issuer ?? 'https://token.actions.githubusercontent.com',
                    subject: cred.subject,
                    description: cred.description ?? '',
                    audiences: ['api://AzureADTokenExchange'],
                }),
            ],
        }));
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
                command: 'az',
                args: [
                    'role', 'assignment', 'create',
                    '--assignee', `$${appIdVar}`,
                    '--role', ra.role,
                    '--scope', scope,
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
