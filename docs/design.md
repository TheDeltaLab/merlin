背景
1. 当前创建app时需要手动的依次创建所依赖的资源，添加所需的权限，添加相关的环境变量，设置启动配置等，极易少配/误配相关资源。 同时配置相关资源时需要多种权限，费时费力。
2. 当前Merlin的代码以函数形式管理相关资源的部署逻辑，添加其他资源时代码维护的成本较高
目标
1. 部署应用时根据所提供的资源配置文件，全自动化的创建相关资源，添加所需权限，配置环境变量，设置启动项。
2. 以当前代码实现为基础，重写相关代码，便于添加任意类型的资源。
非目标
- 根据代码进行资源依赖检查
- 自动化的生成资源配置文件
- 代码构建、打包、部署
- 资源的生命周期管理(不删除资源/权限)
设计考虑

声明目标状态 vs 声明动作
参考现有实现和类似的开源项目的实现，采用声明目标状态。

权限管理
便于脚本执行，跑之前需申请owner 及 云应用程序管理员 的特权角色以执行脚本。

已有资源处理
如果已有同名资源，则按目标状态更新，状态完全一致的不做更新。

配置设计
```typescript
type Ring = 'test' | 'staging' | 'production';
type ResourceType = 'ThirdPartyApi' | 'AzureContainerApp' | 'StorageAccount';
type Region = 'eastus' | 'westus' | 'krc';

// the resource schema for specific resource
interface ResourceSchema {

};

interface Resource {
    /**
     * resource name, unique in the same ring+region
     */
    name: string;

    /**
     * the parent resource, e.g. a container app need azure container environment
     */
    parent?: string;

    /**
     * the resource type, point to a schema
     */
    type: ResourceType;

    /**
     * the ring this resource belongs to, e.g. test, staging, production.
     */
    ring: Ring;

    /**
     * the region this resource is deployed to, e.g. eastus, westus.
     * undefined means the resource is not region specific or global resource, e.g. third party api.
     */
    region?: Region;

    /**
     * how to auth to another resource
     * this action will be call on resource dependce current resource
     * will bind `target` as argument when call the auth action
     */
    authProvider: Action;

    dependencies: Dependency[];

    defaultConfig: ResourceSchema;
    specficConfigs: ({ ring: Ring; region?: Region } & Partial<ResourceSchema>)[];

    /**
     * key is the export name
     * value is the function to get the export value
     */
    exports: Record<string, () => Promise<string>>;
};

interface Dependency {
    /**
     * the resource name this dependency depends on
     */
    resource: string;

    /**
     * whether this dependency is hard or soft.
     * Hard dependency means the resource must exist before creating the dependent resource.
     */
    isHardDependency?: boolean;
}

interface Action {
    name: string;
    description: string;
    args?: Record<string, any>;
    apply: (source: Resource, args?: Record<string, any>) => Promise<void>;

    /**
     * the required resources to take this action
     * for example, add aliyun-fun-asr permission to an app
     * 1. create an akv resource to store the secret
     * 2. add akv secret reader role to the app
     */
    dependenccies?: Dependency[];
};

interface Command {
    command: string;
    args: string[];
}

interface Render {
    render: (resource: Resource) => Promise<Command[]>;
};

class AzureContainerAppRender implements Render {
    async render(resource: Resource): Promise<Command[]> {
        throw new Error('Not implemented');
    }

    async createContainerApp(resource: Resource): Promise<Command[]> {
        return [
            {
                command: 'az',
                args: ['containerapp', 'create',
                    '--name', 'demo-app',
                    // more args
                ],
            },
        ];
    }

    async addEnv(resource: Resource, environments: Record<string, string>): Promise<void> {}
};

class Merlin {
    async execute(dryRun: boolean = false): Promise<void> {
        // 1. load all resources
        // 2. process dependencies and get the execution order (topological sort)
        // 3. render the command for each resource and execute
        // 4. execute and log the result
    }
};
```
样例
```yml
# resource/worker.yml

name: worker
type: AzureContainerApp
parent: cae
# will create 4 resource (test/production) * (eastus/westus) 
ring:
    - test
    - production
region:
    - eastus
    - westus
authProvider: microsoftIdentityProviderAuth

dependencies:
    - resource: acr
      isHardDependency: true
    - resource: akv
    - resource: aliyun-fun-asr
    - resource: admin
    - resource: turing
    - resource: alluneed
    - resource: postgresql
    - resource: redis
    - resource: abs
defaultConfig:
    cpu: 2
    memory: 4Gi
    identityProvider:
        type: MicrosoftIdentity
        # ...
    # more configs
    # ....
    env:
    - name: REDIS_URL
      # ${ <resource>.<export value>  }
      value: ${ redis.connectionString }
    - name: REDIS_USER
      # self-point variable
      value: ${ worker.identity }
    - name: TURING_API_SCOPE
      value: ${ turing.api_scope }/.default
    # more envs
specficConfigs:
    - ring: production
      region: eastus
      cpu: 4
      memory: 8Gi

exports:
    - url: getResourceUrl
    - identity: getResourceIdentity
    - api_scope: getResourceApiScope
```

```ts
class MicrosoftIdentityProviderAuth implements Action {
    name = 'microsoftIdentityProviderAuth';
    description = 'Auth to another resource using Microsoft Identity Provider, which will create a service principal for the source resource and grant it permission to access the target resource';

    async apply(source: Resource, args?: Record<string, any>): Promise<void> {
        const targetResource = args?.target;
        // add perm to identity provider
    }
};
```
实现

```ts
interface Command {
    command: string;
    args: string[];
}

interface Render {
    render: (resource: Resource) => Promise<Command[]>;
};

class AzureContainerAppRender implements Render {
    async render(resource: Resource): Promise<Command[]> {
        throw new Error('Not implemented');
    }

    async createContainerApp(resource: Resource): Promise<Command[]> {
        return [
            {
                command: 'az',
                args: ['containerapp', 'create',
                    '--name', 'demo-app',
                    // more args
                ],
            },
        ];
    }

    async addEnv(resource: Resource, environments: Record<string, string>): Promise<Command[]> {}
};
 
class Merlin {
    async execute(dryRun: boolean = false): Promise<void> {
        // 1. load all resources
        // 2. process dependencies and get the execution order (topological sort)
        // 3. render the command for each resource and execute
        // 4. execute and log the result
    }
};
```
