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
        const args: string[] = [];
        const config = resource.config;

        args.push('ad', 'app', 'create');
        args.push('--display-name', this.getDisplayName(resource));

        this.addSimpleParams(args, config, AzureADAppRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureADAppRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureADAppRender.ARRAY_PARAM_MAP);

        return [{
            command: 'az',
            args,
        }];
    }

    renderUpdate(resource: AzureADAppResource, objectId: string): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('ad', 'app', 'update');
        args.push('--id', objectId);

        // --display-name is omitted in update: it is the lookup key and should not be changed

        this.addSimpleParams(args, config, AzureADAppRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureADAppRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureADAppRender.ARRAY_PARAM_MAP);

        return [{
            command: 'az',
            args,
        }];
    }
}
