export type Ring = 'test' | 'staging' | 'production';
export type ResourceType = 'ThirdPartyApi' | 'AzureContainerApp' | 'StorageAccount';
export type Region = 'eastus' | 'westus' | 'krc';

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
}

/**
 * Action interface for resource operations
 */
export interface Action {
    name: string;
    description: string;
    args?: Record<string, unknown>;
    apply: (source: Resource, args?: Record<string, unknown>) => Promise<void>;

    /**
     * The required resources to take this action
     * For example, add aliyun-fun-asr permission to an app
     * 1. create an akv resource to store the secret
     * 2. add akv secret reader role to the app
     */
    dependencies?: Dependency[];
}

/**
 * Command to be executed
 */
export interface Command {
    command: string;
    args: string[];
}

/**
 * Render interface for converting resources to commands
 */
export interface Render {
    render: (resource: Resource) => Promise<Command[]>;
}

/**
 * Resource definition
 */
export interface Resource<T extends ResourceSchema = ResourceSchema> {
    /**
     * Resource name, unique in the same ring+region
     */
    name: string;

    /**
     * The parent resource, e.g. a container app needs azure container environment
     */
    parent?: string;

    /**
     * The resource type, points to a schema
     */
    type: ResourceType;

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
     * How to auth to another resource
     * This action will be called on resource that depends on current resource
     * Will bind `target` as argument when calling the auth action
     */
    authProvider: Action;

    dependencies: Dependency[];

    defaultConfig: T;
    specificConfigs: ({ ring: Ring; region?: Region } & Partial<T>)[];

    /**
     * Key is the export name
     * Value is the function to get the export value
     */
    exports: Record<string, () => Promise<string>>;
}
