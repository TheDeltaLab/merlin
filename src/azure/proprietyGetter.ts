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
                '-o', 'json'
            ],
            resultParser: (output: string): string => {
                const result = JSON.parse(output);
                if (!Array.isArray(result)) {
                    throw new Error('Expected result to be an array');
                }
                if (result.length !== 1) {
                    throw new Error(`Expected 1 result, got ${result.length} items`);
                }
                return result[0].id as string;
            }
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
                '-o', 'json'
            ],
            resultParser: (output: string): string => {
                const result = JSON.parse(output);
                if (!result.loginServer) {
                    throw new Error('Expected loginServer in az acr show output');
                }
                return result.loginServer as string;
            }
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
                '-o', 'json'
            ],
            resultParser: (output: string): string => {
                const result = JSON.parse(output);
                const fqdn = result?.properties?.configuration?.ingress?.fqdn;
                if (!fqdn) {
                    throw new Error('Expected fqdn in az containerapp show output');
                }
                return fqdn as string;
            }
        }];
    }
}

// Register propriety getters
registerProprietyGetter(new AzureResourceManagedIdentityGetter());
registerProprietyGetter(new AzureResourceNameGetter());
registerProprietyGetter(new AzureContainerRegistryServerGetter());
registerProprietyGetter(new AzureContainerAppFqdnGetter());