
export type Ring = 
    | 'test' 
    | 'staging' 
    | 'production';
    
export const RING_SHORT_NAME_MAP: Record<Ring, string> = {
    'test': 'tst',
    'staging': 'stg',
    'production': 'prd'
};

export type Region = 
    | 'eastus' 
    | 'westus' 
    | 'eastasia'
    | 'koreacentral'
    | 'koreasouth'
    ;

export const REGION_SHORT_NAME_MAP: Record<Region, string> = {
    'eastus': 'eus',
    'westus': 'wus',
    'eastasia': 'eas',
    'koreacentral': 'krc',
    'koreasouth': 'krs',
};

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
    authProvider?: AuthProvider;
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
     */
    ring: Ring;

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
        getter: ProprietyGetter;
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

export interface ProprietyGetter {
    name: string;

    /**
     * return the commands to get the propriety value
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


const PROPRIETY_GETTER_MAP: Map<string, ProprietyGetter> = new Map();

export function registerProprietyGetter(getter: ProprietyGetter) {
    PROPRIETY_GETTER_MAP.set(getter.name, getter);
}


export function getProprietyGetter(name: string): ProprietyGetter {
    const getter = PROPRIETY_GETTER_MAP.get(name);
    if (!getter) {
        throw new Error(`ProprietyGetter not found for name: ${name}`);
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