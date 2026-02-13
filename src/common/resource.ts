import { Command } from "./render";

export type Ring = 
    | 'test' 
    | 'staging' 
    | 'production';
    
export type Region = 
    | 'eastus' 
    | 'westus' 
    | 'eastasia'
    | 'koreacentral'
    | 'koreasouth'
    ;

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
    authProvider: AuthProvider;

    dependencies: Dependency[];

    defaultConfig: Schema;
    specificConfigs: ({ ring: Ring; region?: Region } & Partial<Schema>)[];

    /**
     * Key is the export name
     * Value is the function to get the export value
     */
    exports: Record<string, ProprietyGetter>;
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
}

export interface Render {
    render(resource: Resource): Promise<Command[]>;
}