import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { RING_SHORT_NAME_MAP } from '../common/resource.js';
import { execSync } from 'child_process';

export const AZURE_AD_APP_RESOURCE_TYPE = 'AzureADApp';

// refer to: https://learn.microsoft.com/en-us/cli/azure/ad/app?view=azure-cli-latest

export type SignInAudience =
    | 'AzureADMyOrg'
    | 'AzureADMultipleOrgs'
    | 'AzureADandPersonalMicrosoftAccount'
    | 'PersonalMicrosoftAccount';

export interface AzureADAppConfig extends ResourceSchema {
    /**
     * Display name for the Azure AD App.
     * If not provided, it is auto-generated from project + name + ring.
     */
    displayName?: string;

    // Identity / audience
    signInAudience?: SignInAudience;

    // URIs
    identifierUris?: string[];
    webRedirectUris?: string[];
    publicClientRedirectUris?: string[];
    webHomepageUrl?: string;

    // Token issuance
    enableAccessTokenIssuance?: boolean;
    enableIdTokenIssuance?: boolean;

    // Token configuration
    optionalClaims?: string;              // JSON string for --optional-claims
    requestedAccessTokenVersion?: number;

    // API / Role configuration
    requiredResourceAccesses?: string;    // JSON string for --required-resource-accesses
    appRoles?: string;                    // JSON string for --app-roles

    // Miscellaneous
    isFallbackPublicClient?: boolean;
    serviceManagementReference?: string;

    /**
     * Client secrets (credentials) to create for this AD App.
     * Each secret is created via `az ad app credential reset --append`.
     * If a credential with the same displayName already exists, it is skipped.
     */
    clientSecrets?: ClientSecretConfig[];
}

export interface ClientSecretConfig {
    /** Display name for the credential (e.g. "oauth2-proxy") */
    displayName: string;
    /** End date in ISO format (e.g. "2027-03-28"). Omit for Azure's default (2 years). */
    endDate?: string;
    /**
     * Optionally store the generated secret value in an Azure Key Vault.
     * vaultName: the vault name (can use ${ } expressions)
     * secretName: the secret name in the vault
     */
    storeInKeyVault?: {
        vaultName: string;
        secretName: string;
    };
}

export interface AzureADAppResource extends Resource<AzureADAppConfig> {}

export class AzureADAppRender extends AzureResourceRender {
    supportConnectorInResourceName: boolean = true;

    /**
     * Azure AD Apps are tenant-scoped global resources — they have no region.
     * Setting isGlobalResource = true allows region-aware resources (e.g. ACAs)
     * to resolve an AD App dependency by ring only, ignoring region.
     */
    override isGlobalResource: boolean = true;

    override getShortResourceTypeName(): string {
        return 'aad';
    }

    /**
     * Azure AD Apps are global resources — no resource group, no region.
     * Name is: [project-|shared-]<name>-<ring>
     */
    override getResourceName(resource: Resource): string {
        const projectPart = resource.project ? resource.project : 'shared';
        const ringPart = RING_SHORT_NAME_MAP[resource.ring] || resource.ring;
        return [projectPart, resource.name, ringPart].filter(Boolean).join('-');
    }

    /**
     * Configuration mapping for simple key-value parameters
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'signInAudience': '--sign-in-audience',
        'webHomepageUrl': '--web-home-page-url',
        'optionalClaims': '--optional-claims',
        'requestedAccessTokenVersion': '--requested-access-token-version',
        'requiredResourceAccesses': '--required-resource-accesses',
        'appRoles': '--app-roles',
        'serviceManagementReference': '--service-management-reference',
    };

    /**
     * Configuration mapping for boolean flags
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableAccessTokenIssuance': '--enable-access-token-issuance',
        'enableIdTokenIssuance': '--enable-id-token-issuance',
        'isFallbackPublicClient': '--is-fallback-public-client',
    };

    /**
     * Configuration mapping for array parameters
     */
    private static readonly ARRAY_PARAM_MAP: Record<string, string> = {
        'identifierUris': '--identifier-uris',
        'webRedirectUris': '--web-redirect-uris',
        'publicClientRedirectUris': '--public-client-redirect-uris',
    };

    async renderImpl(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        if (!AzureADAppRender.isAzureADAppResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure AD App resource`);
        }

        const deployedProps = await this.getDeployedProps(resource as AzureADAppResource);

        if (!deployedProps) {
            return this.renderCreate(resource as AzureADAppResource);
        } else {
            return this.renderUpdate(resource as AzureADAppResource, deployedProps.objectId);
        }
    }

    private static isAzureADAppResource(resource: Resource): resource is AzureADAppResource {
        return resource.type === AZURE_AD_APP_RESOURCE_TYPE;
    }

    /**
     * Returns the display name used to look up / create the AD App.
     * Uses config.displayName if specified, otherwise auto-generates from resource naming.
     */
    getDisplayName(resource: AzureADAppResource): string {
        return resource.config.displayName ?? this.getResourceName(resource);
    }

    private async getDeployedProps(resource: AzureADAppResource): Promise<{ objectId: string } | undefined> {
        const displayName = this.getDisplayName(resource);

        try {
            const result = execSync(
                `az ad app list --filter "displayName eq '${displayName}'" --output json 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const apps = JSON.parse(result);

            if (!Array.isArray(apps) || apps.length === 0) {
                return undefined;
            }

            // Return the first matching app's objectId
            const objectId = apps[0].id as string;
            return { objectId };

        } catch (error: any) {
            // Azure CLI failure — likely auth issue or not found
            if (error.status === 3 || error.status === 1) {
                return undefined;
            }

            const errorMessage = error.message || String(error);
            const stderr = error.stderr?.toString() || '';
            const combinedError = errorMessage + ' ' + stderr;

            if (combinedError.includes('ResourceNotFound') ||
                combinedError.includes('was not found') ||
                combinedError.includes('could not be found')) {
                return undefined;
            }

            throw new Error(
                `Failed to get deployed properties for Azure AD App '${displayName}': ${error}`
            );
        }
    }

    renderCreate(resource: AzureADAppResource): Command[] {
        const config = resource.config;

        // Step 1: create without identifierUris (may contain "api://self" placeholder
        // which requires the appId — not known until after creation)
        const createArgs: string[] = [];
        createArgs.push('ad', 'app', 'create');
        createArgs.push('--display-name', this.getDisplayName(resource));
        this.addSimpleParams(createArgs, config, AzureADAppRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(createArgs, config, AzureADAppRender.BOOLEAN_FLAG_MAP);
        const arrayParamsWithoutUris = Object.fromEntries(
            Object.entries(AzureADAppRender.ARRAY_PARAM_MAP).filter(([k]) => k !== 'identifierUris')
        );
        this.addArrayParams(createArgs, config, arrayParamsWithoutUris);

        const commands: Command[] = [{ command: 'az', args: createArgs }];

        // Step 2: capture the newly created appId
        const appIdVar = `MERLIN_AAD_NEW_${this.getDisplayName(resource).toUpperCase().replace(/-/g, '_')}_APPID`;
        commands.push({
            command: 'az',
            args: ['ad', 'app', 'list', '--filter', `displayName eq '${this.getDisplayName(resource)}'`, '--query', '[0].appId', '-o', 'tsv'],
            envCapture: appIdVar,
        });

        // Step 3: set identifierUris now that appId is known
        // "api://self" is a placeholder meaning "api://<this app's own clientId>"
        if (config.identifierUris && (config.identifierUris as string[]).length > 0) {
            const resolvedUris = (config.identifierUris as string[]).map(uri =>
                uri.replace(/^api:\/\/self$/, `api://$${appIdVar}`)
            );
            commands.push({
                command: 'az',
                args: ['ad', 'app', 'update', '--id', `$${appIdVar}`, '--identifier-uris', ...resolvedUris],
            });
        }

        // Step 4: create the Service Principal (enterprise app) for this AD App registration
        commands.push({
            command: 'az',
            args: ['ad', 'sp', 'create', '--id', `$${appIdVar}`],
        });

        // Step 5: create client secrets (credentials) if configured
        commands.push(...this.renderClientSecrets(resource, appIdVar));

        return commands;
    }

    renderUpdate(resource: AzureADAppResource, objectId: string): Command[] {
        const config = resource.config;

        // Step 1: capture the existing appId (needed to resolve "api://self" in identifierUris
        // and for client secret creation)
        const appIdVar = `MERLIN_AAD_UPD_${this.getDisplayName(resource).toUpperCase().replace(/-/g, '_')}_APPID`;
        const commands: Command[] = [];

        const hasApiSelf = (config.identifierUris as string[] | undefined)?.some(u => u === 'api://self');
        const hasClientSecrets = config.clientSecrets && (config.clientSecrets as ClientSecretConfig[]).length > 0;

        if (hasApiSelf || hasClientSecrets) {
            commands.push({
                command: 'az',
                args: ['ad', 'app', 'list', '--filter', `displayName eq '${this.getDisplayName(resource)}'`, '--query', '[0].appId', '-o', 'tsv'],
                envCapture: appIdVar,
            });
        }

        const updateArgs: string[] = [];
        updateArgs.push('ad', 'app', 'update');
        updateArgs.push('--id', objectId);

        // --display-name is omitted in update: it is the lookup key and should not be changed
        this.addSimpleParams(updateArgs, config, AzureADAppRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(updateArgs, config, AzureADAppRender.BOOLEAN_FLAG_MAP);

        // Resolve "api://self" placeholder before passing to addArrayParams
        const resolvedConfig = hasApiSelf ? {
            ...config,
            identifierUris: (config.identifierUris as string[]).map(u =>
                u === 'api://self' ? `api://$${appIdVar}` : u
            ),
        } : config;
        this.addArrayParams(updateArgs, resolvedConfig, AzureADAppRender.ARRAY_PARAM_MAP);

        commands.push({ command: 'az', args: updateArgs });

        // Create client secrets (credentials) if configured
        commands.push(...this.renderClientSecrets(resource, appIdVar));

        return commands;
    }

    /**
     * Render client secret (credential) creation commands.
     *
     * For each configured client secret:
     * 1. Check if a credential with the same displayName already exists (skip if so)
     * 2. Create the credential via `az ad app credential reset --append`
     * 3. Optionally store the secret value in Azure Key Vault
     *
     * The check-then-create approach avoids rotating secrets on every deploy.
     */
    renderClientSecrets(resource: AzureADAppResource, appIdVar: string): Command[] {
        const config = resource.config;
        if (!config.clientSecrets || (config.clientSecrets as ClientSecretConfig[]).length === 0) return [];

        const commands: Command[] = [];

        for (const secret of config.clientSecrets as ClientSecretConfig[]) {
            const safeName = secret.displayName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            const secretVar = `MERLIN_AAD_CLIENT_SECRET_${safeName}`;

            // Check if credential already exists — if so, skip creation.
            // `az ad app credential list` returns an array; we filter by displayName.
            // If a match is found, we skip; otherwise, we create.
            const checkAndCreateArgs = [
                `EXISTING=$(az ad app credential list --id $${appIdVar} --query "[?displayName=='${secret.displayName}'].keyId | [0]" -o tsv 2>/dev/null || true)`,
                `if [ -z "$EXISTING" ]; then`,
            ];

            const credArgs = ['ad', 'app', 'credential', 'reset',
                              '--id', `$${appIdVar}`,
                              '--append',
                              '--display-name', secret.displayName,
                              '--query', 'password', '-o', 'tsv'];
            if (secret.endDate) {
                credArgs.push('--end-date', secret.endDate);
            }
            const credCommand = `az ${credArgs.join(' ')}`;

            if (secret.storeInKeyVault) {
                // Create credential and store in Key Vault
                const kvSetCommand = `az keyvault secret set --vault-name ${secret.storeInKeyVault.vaultName} --name ${secret.storeInKeyVault.secretName} --value $${secretVar}`;
                commands.push({
                    command: 'bash',
                    args: ['-c', [
                        ...checkAndCreateArgs,
                        `  ${secretVar}=$(${credCommand})`,
                        `  ${kvSetCommand}`,
                        `fi`,
                    ].join('\n')],
                });
            } else {
                // Create credential only (no Key Vault storage)
                commands.push({
                    command: 'bash',
                    args: ['-c', [
                        ...checkAndCreateArgs,
                        `  ${secretVar}=$(${credCommand})`,
                        `fi`,
                    ].join('\n')],
                });
            }
        }

        return commands;
    }
}
