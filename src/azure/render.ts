
import { Command, Render, Region, Resource, REGION_SHORT_NAME_MAP, RING_SHORT_NAME_MAP } from "../common/resource";
import { resolveConfig } from "../common/paramResolver.js";


export abstract class AzureResourceRender implements Render {
    /**
     * whether support connector in resource name. If true, the render will remove all connector in the rendered resource name
     */
    abstract supportConnectorInResourceName: boolean;

    /**
     * Outer render method (Template Method pattern).
     * Resolves all ${ } parameter expressions in resource.config,
     * then delegates to renderImpl() with the fully-resolved resource.
     */
    async render(resource: Resource): Promise<Command[]> {
        const resolved = await resolveConfig(resource);
        return this.renderImpl(resolved);
    }

    /**
     * Subclasses implement their render logic here.
     * The resource passed in has all parameter expressions already resolved to plain values.
     */
    protected abstract renderImpl(resource: Resource): Promise<Command[]>;

    abstract getShortResourceTypeName(): string;


    renderLogin(): Command[] {
        return [
            {
                command: 'az',
                args: ['login']
            }
        ];
    }

    getResourceGroupName(resource: Resource): string {
        // [${project}-|shared]-rg-${ring}[-${region}]
        const projectPart = resource.project ? `${resource.project}` : 'shared';
        const ringPart = `rg-${RING_SHORT_NAME_MAP[resource.ring] || resource.ring}`;
        const regionPart = resource.region ? `${REGION_SHORT_NAME_MAP[resource.region] || resource.region}` : '';
        return [projectPart, ringPart, regionPart].filter(item => item).join('-');
    }

    getResourceName(resource: Resource): string {
        // [${project}-|shared]-${name}-${ring}[-${region}][-${type}]
        const projectPart = resource.project ? `${resource.project}` : 'shared';
        const ringPart = `${RING_SHORT_NAME_MAP[resource.ring] || resource.ring}`;
        const regionPart = resource.region ? `${REGION_SHORT_NAME_MAP[resource.region] || resource.region}` : '';
        const typePart = resource.type ? `${this.getShortResourceTypeName()}` : '';
        const result = [projectPart, resource.name, ringPart, regionPart, typePart].filter(item => item).join(this.supportConnectorInResourceName ? '-' : '');
        return result;
    }

    /**
     * Add simple key-value parameters to args array
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param paramMap - Map of config keys to CLI flags (e.g., { 'accessTier': '--access-tier' })
     */
    protected addSimpleParams(args: string[], config: Record<string, any>, paramMap: Record<string, string>): void {
        for (const [configKey, cliFlag] of Object.entries(paramMap)) {
            const value = config[configKey];
            if (value !== undefined && value !== null) {
                args.push(cliFlag);
                args.push(String(value));
            }
        }
    }

    /**
     * Add boolean flags to args array
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param flagMap - Map of config keys to CLI flags (e.g., { 'httpsOnly': '--https-only' })
     */
    protected addBooleanFlags(args: string[], config: Record<string, any>, flagMap: Record<string, string>): void {
        for (const [configKey, cliFlag] of Object.entries(flagMap)) {
            const value = config[configKey];
            if (value === true) {
                args.push(cliFlag);
                args.push('true');
            } else if (value === false) {
                args.push(cliFlag);
                args.push('false');
            }
        }
    }

    /**
     * Add array-type parameters to args array
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param arrayParamMap - Map of config keys to CLI flags (e.g., { 'bypass': '--bypass' })
     */
    protected addArrayParams(args: string[], config: Record<string, any>, arrayParamMap: Record<string, string>): void {
        for (const [configKey, cliFlag] of Object.entries(arrayParamMap)) {
            const value = config[configKey];
            if (Array.isArray(value) && value.length > 0) {
                args.push(cliFlag);
                args.push(value.join(' '));
            }
        }
    }

    /**
     * Add tags to args array
     * @param args - The args array to append to
     * @param tags - Tags object with key-value pairs
     */
    protected addTags(args: string[], tags?: Record<string, string>): void {
        if (tags && Object.keys(tags).length > 0) {
            args.push('--tags');
            for (const [key, value] of Object.entries(tags)) {
                args.push(`${key}=${value}`);
            }
        }
    }

    /**
     * Ensure resource group exists and return creation commands if needed
     * @param resource - The resource that needs a resource group
     * @returns Commands to create the resource group if it doesn't exist, empty array otherwise
     */
    protected async ensureResourceGroupCommands(resource: Resource): Promise<Command[]> {
        // Dynamic import to avoid circular dependency
        const { AzureResourceGroupRender } = await import('./resourceGroup.js');

        // Use AzureResourceGroupRender to check and generate commands
        // Pass the original resource - it will calculate the RG name from it
        const rgRender = new AzureResourceGroupRender();
        return await rgRender.render(resource);
    }
}

