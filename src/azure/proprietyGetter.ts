import { Command, Dependency, ProprietyGetter, Resource, getRender } from "../common/resource.js";
import { resolveConfig } from "../common/paramResolver.js";
import { AzureResourceRender } from "./render.js";
import { AzureDnsZoneRender, AzureDnsZoneResource } from "./azureDnsZone.js";
import { AzureADAppRender, AzureADAppResource } from "./azureADApp.js";

/**
 * ProprietyGetter for Azure Resource Managed Identity,
 * more specifically, it returns the ObjectId of the managed identity.
 */
export class AzureResourceManagedIdentityGetter implements ProprietyGetter {
    name: string = 'AzureResourceManagedIdentity';

    dependencies: Dependency[] = [];

    async get(resource: Resource, args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const identityName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'ad', 'sp', 'list',
                '--filter', `displayName eq '${identityName}' and servicePrincipalType eq 'ManagedIdentity'`,
                '-o', 'tsv',
                '--query', '[0].id'
            ]
        }];
    }
}

export class AzureResourceNameGetter implements ProprietyGetter {
    name: string = 'AzureResourceName';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const fullname = render.getResourceName(resource);
        return [{
            command: 'echo',
            args: [fullname]
        }];
    }
}

/**
 * ProprietyGetter for Azure Container Registry login server URL.
 * Returns the loginServer field (e.g. "myregistry.azurecr.io") of the ACR.
 */
export class AzureContainerRegistryServerGetter implements ProprietyGetter {
    name: string = 'AzureContainerRegistryServer';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'acr', 'show',
                '-g', resourceGroup,
                '-n', resourceName,
                '-o', 'tsv',
                '--query', 'loginServer'
            ]
        }];
    }
}

export class AzureContainerAppFqdnGetter implements ProprietyGetter {
    name: string = 'AzureContainerAppFqdn';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'containerapp', 'show',
                '-g', resourceGroup,
                '-n', resourceName,
                '-o', 'tsv',
                '--query', 'properties.configuration.ingress.fqdn'
            ]
        }];
    }
}

export class AzureLogAnalyticsWorkspaceCustomerIdGetter implements ProprietyGetter {
    name: string = 'AzureLogAnalyticsWorkspaceCustomerId';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'monitor', 'log-analytics', 'workspace', 'show',
                '--name', resourceName,
                '-g', resourceGroup,
                '-o', 'tsv',
                '--query', 'customerId'
            ]
        }];
    }
}

export class AzureLogAnalyticsWorkspaceSharedKeyGetter implements ProprietyGetter {
    name: string = 'AzureLogAnalyticsWorkspaceSharedKey';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'monitor', 'log-analytics', 'workspace', 'get-shared-keys',
                '--name', resourceName,
                '-g', resourceGroup,
                '-o', 'tsv',
                '--query', 'primarySharedKey'
            ]
        }];
    }
}

/**
 * ProprietyGetter for Azure AD App client ID (appId).
 * Returns the appId (client ID) of the Azure AD application by display name.
 */
export class AzureADAppClientIdGetter implements ProprietyGetter {
    name: string = 'AzureADAppClientId';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureADAppRender;
        // config.displayName may be an unresolved param expression — resolve it first.
        const { resource: resolved } = await resolveConfig(resource as AzureADAppResource);
        const displayName = render.getDisplayName(resolved as AzureADAppResource);

        return [{
            command: 'az',
            args: [
                'ad', 'app', 'list',
                '--filter', `displayName eq '${displayName}'`,
                '-o', 'tsv',
                '--query', '[0].appId'
            ]
        }];
    }
}

/**
 * ProprietyGetter for Azure DNS Zone full domain name.
 * Returns the complete DNS zone name (e.g. "chuang.staging.thebrainly.dev")
 * by combining dnsName and parentName from the resource config.
 */
export class AzureDnsZoneNameGetter implements ProprietyGetter {
    name: string = 'AzureDnsZoneName';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureDnsZoneRender;
        const dnsZoneName = render.getDnsZoneName(resource as AzureDnsZoneResource);
        return [{
            command: 'echo',
            args: [dnsZoneName]
        }];
    }
}

/**
 * ProprietyGetter for Azure Key Vault vault URI.
 * Returns the vaultUri (e.g. "https://mykeyvault.vault.azure.net/") of the Key Vault.
 */
export class AzureKeyVaultUrlGetter implements ProprietyGetter {
    name: string = 'AzureKeyVaultUrl';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'keyvault', 'show',
                '-g', resourceGroup,
                '-n', resourceName,
                '-o', 'tsv',
                '--query', 'properties.vaultUri'
            ]
        }];
    }
}

/**
 * ProprietyGetter for Azure Service Principal client ID (appId).
 * Returns the appId of the AD App backing the Service Principal, looked up by display name.
 */
export class AzureServicePrincipalClientIdGetter implements ProprietyGetter {
    name: string = 'AzureServicePrincipalClientId';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureServicePrincipalRender;
        const displayName = render.getDisplayName(resource as AzureServicePrincipalResource);

        return [{
            command: 'az',
            args: [
                'ad', 'app', 'list',
                '--filter', `displayName eq '${displayName}'`,
                '-o', 'tsv',
                '--query', '[0].appId'
            ]
        }];
    }
}

/**
 * ProprietyGetter for Azure Redis Enterprise connection URL.
 * Returns the Redis connection URL (rediss://<hostname>:10000) for the Redis Enterprise cluster.
 */
export class AzureRedisEnterpriseUrlGetter implements ProprietyGetter {
    name: string = 'AzureRedisEnterpriseUrl';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'redisenterprise', 'show',
                '-g', resourceGroup,
                '-n', resourceName,
                '-o', 'tsv',
                '--query', "join('', ['rediss://', hostName, ':10000'])"
            ]
        }];
    }
}

/**
 * ProprietyGetter for Azure resource API scope.
 * Returns the API scope string (api://<resourceName>/.default) for the resource.
 */
export class AzureResourceApiScopeGetter implements ProprietyGetter {
    name: string = 'getResourceApiScope';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'echo',
            args: [`api://${resourceName}/.default`]
        }];
    }
}

/**
 * ProprietyGetter for AKS OIDC Issuer URL.
 * Returns the OIDC issuer URL for Workload Identity federated credentials.
 * Required when creating Federated Credentials that trust a K8s ServiceAccount.
 */
export class AzureAKSOidcIssuerUrlGetter implements ProprietyGetter {
    name: string = 'AzureAKSOidcIssuerUrl';

    dependencies: Dependency[] = [];

    async get(resource: Resource, _args: Record<string, string>): Promise<Command[]> {
        const render = getRender(resource.type) as AzureResourceRender;
        const resourceGroup = render.getResourceGroupName(resource);
        const resourceName = render.getResourceName(resource);

        return [{
            command: 'az',
            args: [
                'aks', 'show',
                '-g', resourceGroup,
                '-n', resourceName,
                '-o', 'tsv',
                '--query', 'oidcIssuerProfile.issuerUrl'
            ]
        }];
    }
}
