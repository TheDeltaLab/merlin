import { Command, Dependency, ProprietyGetter, Resource, getRender, registerProprietyGetter } from "../common/resource.js";
import { AzureResourceRender } from "./render.js";

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

// Register propriety getters
registerProprietyGetter(new AzureResourceManagedIdentityGetter());
registerProprietyGetter(new AzureResourceNameGetter());
registerProprietyGetter(new AzureContainerRegistryServerGetter());
registerProprietyGetter(new AzureContainerAppFqdnGetter());