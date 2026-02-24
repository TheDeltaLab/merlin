
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
     * The resource name this dependency depends on
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
     * The parent resource, e.g. a container app needs azure container environment
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
     * How to be added as dependency of another resource
     *
     */
    authProvider: {
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

export interface Command<T = string> {
    command: string;
    args: string[];
    resultParser?(output: string): T;
}

export interface Render {
    render(resource: Resource): Promise<Command[]>;
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