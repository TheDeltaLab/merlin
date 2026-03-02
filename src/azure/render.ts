
import { Command, Render, Resource, RenderContext, REGION_SHORT_NAME_MAP, RING_SHORT_NAME_MAP } from "../common/resource";
import { resolveConfig } from "../common/paramResolver.js";


export abstract class AzureResourceRender implements Render {
    /**
     * whether support connector in resource name. If true, the render will remove all connector in the rendered resource name
     */
    abstract supportConnectorInResourceName: boolean;

    /**
     * Whether this resource type is a global (region-agnostic) resource.
     * Subclasses that represent global resources (e.g. DNS Zones) should override this to true.
     * Defaults to false.
     */
    isGlobalResource: boolean = false;

    /**
     * Outer render method (Template Method pattern).
     * Resolves all ${ } parameter expressions in resource.config into shell
     * variable references, collects the capture commands (envCapture set),
     * then delegates to renderImpl() with the resolved resource.
     *
     * The returned Command[] starts with any capture commands (e.g.
     * `MERLIN_CHUANGACR_SERVER=$(az acr show ...)`) followed by the resource's
     * own deployment commands.  This ensures variables are set before they are
     * referenced in subsequent args.
     */
    async render(resource: Resource, context?: RenderContext): Promise<Command[]> {
        const { resource: resolved, captureCommands } = await resolveConfig(resource);
        const renderCommands = await this.renderImpl(resolved, context);
        return [...captureCommands, ...renderCommands];
    }

    /**
     * Subclasses implement their render logic here.
     * The resource passed in has all parameter expressions already resolved to plain values.
     */
    protected abstract renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]>;

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
                for (const item of value) {
                    args.push(String(item));
                }
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
            // Each key=value pair is pushed as a separate args element so that
            // execa() passes them as distinct subprocess arguments to Azure CLI.
            // args.join(' ') in shell-output mode produces the same correct string.
            for (const [k, v] of Object.entries(tags)) {
                args.push(`${k}=${v}`);
            }
        }
    }

    /**
     * Ensure resource group exists and return creation commands if needed
     * @param resource - The resource that needs a resource group
     * @param context - Optional render context; if skipResourceGroup is true, returns []
     * @returns Commands to create the resource group if it doesn't exist, empty array otherwise
     */
    protected async ensureResourceGroupCommands(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (context?.skipResourceGroup) return [];

        // Dynamic import to avoid circular dependency
        const { AzureResourceGroupRender } = await import('./resourceGroup.js');

        // Use AzureResourceGroupRender to check and generate commands
        // Pass the original resource - it will calculate the RG name from it
        const rgRender = new AzureResourceGroupRender();
        return await rgRender.render(resource);
    }
}

