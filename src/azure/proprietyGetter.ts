import { Dependency, ProprietyGetter, Resource } from "../common/resource.js";

export class AzureResourceManagedIdentityGetter implements ProprietyGetter {
    name: string = 'AzureResourceManagedIdentity';

    dependencies: Dependency[] = [];

    async get(resource: Resource, args: Record<string, string>): Promise<Command[]> {
        throw new Error(`not implemented yet, because we haven't had the scenario to use it. The implementation should be straight forward, we can implement it when we have the real need.`);
    }   
}