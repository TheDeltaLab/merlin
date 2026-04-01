
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
        // Allow config-level override
        const config = resource.config as Record<string, unknown>;
        if (config?.resourceGroupName && typeof config.resourceGroupName === 'string') {
            return config.resourceGroupName;
        }
        // [${project}-|shared]-rg-${ring}[-${region}]
        const projectPart = resource.project ? `${resource.project}` : 'shared';
        const ringPart = `rg-${RING_SHORT_NAME_MAP[resource.ring] || resource.ring}`;
        const regionPart = resource.region ? `${REGION_SHORT_NAME_MAP[resource.region] || resource.region}` : '';
        return [projectPart, ringPart, regionPart].filter(item => item).join('-');
    }

    getResourceName(resource: Resource): string {
        // Allow config-level override
        const config = resource.config as Record<string, unknown>;
        if (config?.resourceName && typeof config.resourceName === 'string') {
            return config.resourceName;
        }
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
     * Add boolean flags to args array (value-accepting: `--flag true` / `--flag false`).
     * Use this for Azure CLI commands that accept true/false as a value argument,
     * e.g. `az storage account create --https-only true`, `az keyvault create --enable-rbac-authorization true`.
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
     * Add presence-only boolean flags to args array (standalone: `--flag` with no value).
     * Use this for Azure CLI commands where the flag is presence-only and does NOT accept
     * true/false as a value, e.g. `az aks create --enable-managed-identity`.
     * The flag is only emitted when the config value is `true`; when `false` it is omitted entirely.
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param flagMap - Map of config keys to CLI flags (e.g., { 'enableManagedIdentity': '--enable-managed-identity' })
     */
    protected addPresenceFlags(args: string[], config: Record<string, any>, flagMap: Record<string, string>): void {
        for (const [configKey, cliFlag] of Object.entries(flagMap)) {
            if (config[configKey] === true) {
                args.push(cliFlag);
            }
        }
    }

    /**
     * Add array-type parameters to args array.
     * Azure CLI expects array values as a single space-joined string argument,
     * e.g. --env-vars "KEY1=VAL1 KEY2=VAL2" rather than separate positional args.
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param arrayParamMap - Map of config keys to CLI flags (e.g., { 'bypass': '--bypass' })
     */
    protected addArrayParams(args: string[], config: Record<string, any>, arrayParamMap: Record<string, string>): void {
        for (const [configKey, cliFlag] of Object.entries(arrayParamMap)) {
            const value = config[configKey];
            if (Array.isArray(value) && value.length > 0) {
                args.push(cliFlag);
                args.push(value.map(String).join(' '));
            }
        }
    }

    /**
     * Add array-type parameters where each value is a separate CLI argument.
     * Use this for CLI flags that accept multiple space-separated values as distinct
     * arguments (e.g. `--encryption-services blob file` rather than `--encryption-services "blob file"`).
     * @param args - The args array to append to
     * @param config - The configuration object
     * @param arrayParamMap - Map of config keys to CLI flags
     */
    protected addMultiValueParams(args: string[], config: Record<string, any>, arrayParamMap: Record<string, string>): void {
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

