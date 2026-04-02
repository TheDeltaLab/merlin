
export const RING_SHORT_NAME_MAP = {
    'test': 'tst',
    'staging': 'stg',
    'production': 'prd',
} as const;
export type Ring = keyof typeof RING_SHORT_NAME_MAP;

export const REGION_SHORT_NAME_MAP = {
    // Azure
    'eastus': 'eus',
    'westus': 'wus',
    'eastasia': 'eas',
    'koreacentral': 'krc',
    'koreasouth': 'krs',
    // Alibaba Cloud
    'cn-hangzhou': 'hzh',
    'cn-shanghai': 'sha',
    'cn-beijing': 'bej',
    'ap-southeast-1': 'sg1',
} as const;
export type Region = keyof typeof REGION_SHORT_NAME_MAP;

/**
 * Base interface for resource-specific configuration schemas
 */
export interface ResourceSchema {
    [key: string]: unknown;
}


/**
 * Dependency declaration
 */
export interface Dependency {
    /**
     * The resource this dependency depends on, in "Type.name" format
     * e.g., "AzureContainerRegistry.chuangacr"
     */
    resource: string;

    /**
     * Whether this dependency is hard or soft.
     * Hard dependency means the resource must exist before creating the dependent resource.
     */
    isHardDependency?: boolean;

    /**
     * if given, will use given auth provider
     * otherwise, will use the default auth provider of the resource
     */
    authProvider?: {
        provider: AuthProvider;
        args: Record<string, string>;
    };
}


/**
 * Resource definition
 */
export interface Resource<Schema extends ResourceSchema = ResourceSchema> {
    /**
     * Resource name, unique in the same ring+region
     */
    name: string;

    /**
     * The project this resource belongs to
     * undefined means it is a shared resource
     */
    project?: string;

    /**
     * Whether this resource was auto-included from shared-resource/ or shared-k8s-resource/.
     * Used by the deployer to skip shared resources when --no-shared is active.
     */
    _isShared?: boolean;

    /**
     * The parent resource, in "Type.name" format
     * e.g., "AzureContainerAppEnvironment.chuangacenv"
     */
    parent?: string;

    /**
     * The resource type, points to a schema
     */
    type: string;

    /**
     * The ring this resource belongs to, e.g. test, staging, production.
     * undefined means the resource is not ring specific (shared across all rings).
     */
    ring?: Ring;

    /**
     * The region this resource is deployed to, e.g. eastus, westus.
     * undefined means the resource is not region specific or global resource, e.g. third party api.
     */
    region?: Region;

    /**
     * Whether this resource is global (region-agnostic), e.g. Azure DNS Zones.
     * Set automatically from the Render implementation at registration time.
     * When true, dependency lookups for this resource ignore the caller's region.
     */
    isGlobalResource?: boolean;

    /**
     * How to be added as dependency of another resource
     *
     */
    authProvider?: {
        provider: AuthProvider;
        args: Record<string, string>;
    };

    dependencies: Dependency[];

    config: Schema;

    /**
     * Key is the export name
     * Value is the getter function and its arguments
     */
    exports: Record<string, {
        getter: PropertyGetter;
        args: Record<string, string>;
    }>;
}


export interface AuthProvider {
    name: string;
    
    /**
     * return the commands to auth requestor to access provider
     */
    apply(requestor: Resource, provider: Resource, args: Record<string, string>): Promise<Command[]>;

    dependencies: Dependency[];
}

export interface PropertyGetter {
    name: string;

    /**
     * return the commands to get the property value
     */
    get(resource: Resource, args: Record<string, string>): Promise<Command[]>;

    dependencies: Dependency[];
}

export interface Command {
    command: string;
    args: string[];
    /**
     * If set, this command's stdout is captured into a shell environment variable
     * with this name (e.g. 'MERLIN_CHUANGACR_SERVER').
     * - In print/file-output mode: emitted as `VARNAME=$(command args)`
     * - In execute mode: stdout is stored in-memory and substituted into
     *   subsequent commands' args where `$VARNAME` appears.
     */
    envCapture?: string;
    /**
     * If set, this content will be written to a temporary file before the command
     * is executed. Any occurrence of `__MERLIN_YAML_FILE__` in args will be replaced
     * with the path to that temporary file.
     *
     * - In execute mode: written to a temp file (deleted after command completes).
     *   $VARNAME references in the content are expanded via expandVars() before writing.
     * - In print mode: content is shown as comments before the command line.
     * - In write-to-file mode: emitted as a heredoc block in the shell script,
     *   with $VARNAME references expanded by the shell at runtime.
     */
    fileContent?: string;
}

/**
 * Context passed from the deployer to render implementations.
 * Allows the deployer to control certain render behaviors.
 */
export interface RenderContext {
    /**
     * When true, the render should skip resource group creation/checking
     * because resource groups are managed centrally by the deployer.
     */
    skipResourceGroup?: boolean;
}

export function commandToString(cmd: Command): string {
    if (!cmd.args || cmd.args.length === 0) {
        return cmd.command;
    }
    return `${cmd.command} ${cmd.args.join(' ')}`;
}

export interface Render {
    render(resource: Resource, context?: RenderContext): Promise<Command[]>;

    /**
     * Returns an abbreviated resource type name used in shell variable names
     * and resource naming (e.g. 'aca', 'acenv', 'acr').
     */
    getShortResourceTypeName(): string;

    /**
     * Whether this resource type is a global (region-agnostic) resource,
     * e.g. Azure DNS Zones. When true, resources of this type are registered
     * without a region, and dependency lookups ignore the caller's region.
     * Defaults to false.
     */
    isGlobalResource?: boolean;
}

/**
 * Pre-deployment provider interface.
 *
 * Cloud providers implement this to handle resource grouping/scoping that must
 * happen before individual resources are deployed. For example, Azure needs
 * resource groups to be created first; other clouds may need projects, VPCs, etc.
 *
 * The deployer calls `renderPreDeployLevel()` once per deploy to build
 * "level 0" — a set of synthetic resources that run before everything else.
 */
export interface PreDeployProvider {
    /**
     * Inspect the full set of resources to be deployed and return a list of
     * pre-deployment resource+command pairs (e.g. resource group creation commands).
     * Implementations should deduplicate internally.
     */
    renderPreDeployLevel(resources: Resource[]): Promise<{ resource: Resource; commands: Command[] }[]>;
}


const RESOURCE_TYPE_RENDER_MAP: Map<string, Render> = new Map();

export function registerRender(resourceType: string, render: Render) {
    RESOURCE_TYPE_RENDER_MAP.set(resourceType, render);
}


export function getRender(resourceType: string): Render {
    const render = RESOURCE_TYPE_RENDER_MAP.get(resourceType);
    if (!render) {
        throw new Error(`Render not found for resource type: ${resourceType}`);
    }
    return render;
}


const PROPERTY_GETTER_MAP: Map<string, PropertyGetter> = new Map();

export function registerPropertyGetter(getter: PropertyGetter) {
    PROPERTY_GETTER_MAP.set(getter.name, getter);
}


export function getPropertyGetter(name: string): PropertyGetter {
    const getter = PROPERTY_GETTER_MAP.get(name);
    if (!getter) {
        throw new Error(`PropertyGetter not found for name: ${name}`);
    }
    return getter;
}


const AUTH_PROVIDER_MAP: Map<string, AuthProvider> = new Map();

export function registerAuthProvider(provider: AuthProvider) {
    AUTH_PROVIDER_MAP.set(provider.name, provider);
}


export function getAuthProvider(name: string): AuthProvider {
    const provider = AUTH_PROVIDER_MAP.get(name);
    if (!provider) {
        throw new Error(`AuthProvider not found for name: ${name}`);
    }
    return provider;
}


// ── Pre-deploy provider ───────────────────────────────────────────────────────

let preDeployProvider: PreDeployProvider | undefined;

/**
 * Register the pre-deploy provider for the current cloud.
 * Called from init.ts during cloud-specific initialization.
 */
export function registerPreDeployProvider(provider: PreDeployProvider): void {
    preDeployProvider = provider;
}

/**
 * Get the registered pre-deploy provider, if any.
 * Returns undefined when no provider is registered (e.g. a cloud that doesn't
 * need pre-deployment steps).
 */
export function getPreDeployProvider(): PreDeployProvider | undefined {
    return preDeployProvider;
}