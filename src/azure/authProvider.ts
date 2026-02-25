import { AuthProvider, Command, Dependency, Resource } from "../common/resource.js";

export class AzureManagedIdentityAuthProvider implements AuthProvider {
    name: string = 'AzureManagedIdentity';

    dependencies: Dependency[] = [];

    async apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]> {
        throw new Error(`not implemented yet`);
    }
}


export class AzureEntraIDAuthProvider implements AuthProvider {
    name: string = 'AzureEntraID';

    dependencies: Dependency[] = [];

    async apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]> {
        throw new Error(`not implemented yet`);
    }
}