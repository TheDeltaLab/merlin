import { AuthProvider, Dependency, Resource } from "../common/resource.js";

export class AzureManagedIdentityAuthProvider implements AuthProvider {
    name: string = 'AzureManagedIdentity';

    dependencies: Dependency[] = [];

    async apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]> {
        throw new Error(`not implemented yet, because we haven't had the scenario to use it. The implementation should be straight forward, we can implement it when we have the real need.`);
    }
}