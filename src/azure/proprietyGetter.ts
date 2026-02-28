import { Command, Dependency, ProprietyGetter, Resource, getRender } from "../common/resource.js";
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

