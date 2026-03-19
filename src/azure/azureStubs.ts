/**
 * Stub Render implementations for Azure resource types that are declared in YAML
 * but do not yet have full Render implementations.
 *
 * These stubs provide getResourceName() / getResourceGroupName() so that
 * ProprietyGetters can construct the correct Azure CLI commands.
 * renderImpl() returns an empty array (no-op deploy).
 */

import { Resource, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';

export const AZURE_KEY_VAULT_RESOURCE_TYPE         = 'AzureKeyVault';
export const AZURE_REDIS_ENTERPRISE_RESOURCE_TYPE  = 'AzureRedisEnterprise';
export const AZURE_POSTGRESQL_RESOURCE_TYPE        = 'AzurePostgreSQLFlexible';
export const AZURE_FUNCTION_APP_RESOURCE_TYPE      = 'AzureFunctionApp';

export class AzureKeyVaultRender extends AzureResourceRender {
    supportConnectorInResourceName = false;
    getShortResourceTypeName(): string { return 'akv'; }
    protected async renderImpl(_resource: Resource, _context?: RenderContext): Promise<Command[]> {
        return [];
    }
}

export class AzureRedisEnterpriseRender extends AzureResourceRender {
    supportConnectorInResourceName = false;
    getShortResourceTypeName(): string { return 'redis'; }
    protected async renderImpl(_resource: Resource, _context?: RenderContext): Promise<Command[]> {
        return [];
    }
}

export class AzurePostgreSQLFlexibleRender extends AzureResourceRender {
    supportConnectorInResourceName = false;
    getShortResourceTypeName(): string { return 'psql'; }
    protected async renderImpl(_resource: Resource, _context?: RenderContext): Promise<Command[]> {
        return [];
    }
}

export class AzureFunctionAppRender extends AzureResourceRender {
    supportConnectorInResourceName = true;
    getShortResourceTypeName(): string { return 'func'; }
    protected async renderImpl(_resource: Resource, _context?: RenderContext): Promise<Command[]> {
        return [];
    }
}
