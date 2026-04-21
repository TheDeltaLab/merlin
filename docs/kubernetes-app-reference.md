# KubernetesApp YAML 完整参考

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md)

`KubernetesApp` 是一个**编译时复合类型**，会自动展开为 `KubernetesDeployment` + `KubernetesService` + `KubernetesIngress`（可选）。

### 最小示例

```yaml
name: myapp
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true

defaultConfig:
  namespace: myapp
  image: brainlysharedacr.azurecr.io/myapp:latest
  port: 3000
```

这就够了。Merlin 会自动填充：
- CPU/内存限制（250m/512Mi request, 500m/1Gi limit）
- 三个探针（liveness/readiness/startup，都用 HTTP GET `/`）
- ClusterIP Service
- 1 个副本

### 完整字段说明

```yaml
name: myapp
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.myapp-aad       # 如果需要 OAuth2
    isHardDependency: true
  - resource: KubernetesConfigMap.myapp-shared-config # 如果有 ConfigMap
    isHardDependency: true

defaultConfig:
  # ── 必填 ──────────────────────────────────────────
  namespace: myapp                                    # K8s namespace
  image: brainlysharedacr.azurecr.io/myapp:latest    # 容器镜像
  port: 3000                                          # 容器端口

  # ── 可选：基础 ────────────────────────────────────
  containerName: app                  # 容器名（默认：从 name 推导）
  replicas: 1                         # 副本数（默认：1）
  healthPath: /                       # 探针路径（默认："/"）
  imagePullPolicy: IfNotPresent       # 默认：IfNotPresent

  # ── 可选：资源限制 ────────────────────────────────
  # 省略则用默认值
  resources:
    cpuRequest: "250m"                # 默认：250m
    memoryRequest: 512Mi              # 默认：512Mi
    cpuLimit: "500m"                  # 默认：500m
    memoryLimit: 1Gi                  # 默认：1Gi

  # ── 可选：Workload Identity ───────────────────────
  serviceAccountName: myapp-workload-sa   # 关联 ServiceAccount

  # ── 可选：Key Vault Secrets ───────────────────────
  secretProvider: myapp-secret-provider   # SecretProviderClass 名

  # ── 可选：环境变量 ────────────────────────────────
  envFrom:
    - configMapRef: myapp-shared-config   # 从 ConfigMap 注入
    - secretRef: myapp-secrets            # 从 Secret 注入
  envVars:
    - APP_ENV=${ this.ring }              # 支持 ${ } 表达式
    - KEY_VAULT_URL=${ AzureKeyVault.shared.url }
    - STATIC_VALUE=hello

  # ── 可选：探针 ────────────────────────────────────
  # 省略 → 使用默认探针（HTTP GET healthPath）
  # 设为 false → 完全禁用所有探针
  probes:
    startup:                              # 自定义 startup 探针
      httpGet:
        path: /
        port: 3000
      initialDelaySeconds: 1
      periodSeconds: 10
      timeoutSeconds: 30
      failureThreshold: 30
    liveness:                             # 自定义 liveness 探针
      httpGet:
        path: /
        port: 3000
      periodSeconds: 60
      timeoutSeconds: 30
      failureThreshold: 30
    readiness:                            # 自定义 readiness 探针
      httpGet:
        path: /
        port: 3000
      periodSeconds: 10
      timeoutSeconds: 30
      failureThreshold: 30

  # ── 可选：Ingress ─────────────────────────────────
  # 省略 → 不生成 Ingress（纯内部服务/worker）
  ingress:
    subdomain: myapp                      # 子域名（和 dnsZone 配合自动拼接 host）
    dnsZone: thebrainly.dev               # DNS zone（也用于 bindDnsZone）
    # 最终域名 = subdomain.{ring}.dnsZone → myapp.staging.thebrainly.dev
    # host: "${ this.ring }.myapp.thebrainly.dev"  # 可选：自定义 host 模板，覆盖自动拼接
    path: /                               # 默认："/"
    clusterIssuer: letsencrypt-prod       # 默认：letsencrypt-prod
    ingressClassName: nginx               # 默认：nginx
    bindDnsZone: true                     # 默认：true（自动创建 DNS A 记录，需要 dnsZone）
    annotations:                          # 额外 Ingress 注解
      nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    dependencies:                         # Ingress 的额外依赖
      - resource: KubernetesIngress.oauth2-proxy
        isHardDependency: true

  # ── 可选：高级覆盖 ────────────────────────────────
  deploymentOverrides: {}                 # 直接覆盖 Deployment config
  serviceOverrides: {}                    # 直接覆盖 Service config
  ingressOverrides: {}                    # 直接覆盖 Ingress config

# ── 按环境覆盖 ──────────────────────────────────────
specificConfig:
  - ring: staging
    replicas: 2                           # staging 用 2 副本
  - ring: production
    replicas: 4
    resources:
      cpuRequest: "1000m"
      memoryRequest: 2Gi
```

### 默认值速查

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `replicas` | `1` | 见下方「副本数推荐」 |
| `healthPath` | `/` | 用于所有探针 |
| `imagePullPolicy` | `IfNotPresent` | |
| `resources.cpuRequest` | `250m` | |
| `resources.memoryRequest` | `512Mi` | |
| `resources.cpuLimit` | `500m` | |
| `resources.memoryLimit` | `1Gi` | |
| `ingress.path` | `/` | |
| `ingress.ingressClassName` | `nginx` | |
| `ingress.clusterIssuer` | `letsencrypt-prod` | |
| `ingress.bindDnsZone` | `true` | 自动创建 DNS A 记录（需要 `dnsZone`） |
| `ingress.host` | `{subdomain}.{ring}.{dnsZone}` | 自定义时覆盖自动拼接 |

### 探针默认值（省略 `probes` 时自动生成）

| 探针 | 类型 | 路径 | 关键参数 |
|------|------|------|---------|
| startup | HTTP GET | `healthPath` | initialDelay=1s, period=1s, failure=240 |
| liveness | HTTP GET | `healthPath` | period=10s, timeout=5s, failure=3 |
| readiness | HTTP GET | `healthPath` | period=5s, timeout=5s, failure=48 |

### 副本数推荐

`replicas` 默认 `1`，**生产环境的用户面向应用必须显式设置成 ≥ 2** 以避免单点故障。

| Workload 类型 | test | staging | production | 备注 |
|--------------|------|---------|-----------|------|
| 用户面向（web/admin/home/dashboard） | 1 | 2 | 3+ | 滚动更新和节点维护期间不能中断 |
| 内部 API（lance、gateway 等） | 1 | 1–2 | 2 | 上游若有重试可单副本 |
| 异步 worker（消费 BullMQ/MQ） | 1 | 1 | 1 | HPA 暂未支持，按需手动调高，见下方 |
| 一次性任务/定时任务 | 1 | 1 | 1 | 不需多副本 |

**何时必须多副本**

- 用户能直接访问到（HTTP UI / 公网 API）—— pod 重启 / 节点 drain 时不能 503
- 滚动发版期间不能中断（`maxUnavailable: 0` + replicas ≥ 2）
- QPS 较高，单 pod 资源吃不下

**何时可以单副本**

- 内部低频服务（管理工具、cron 触发的 admin job）
- 异步消费者：消息已持久化在 MQ，pod 重启期间消息不丢，重启后追上即可
- test / dev / staging 等非关键环境

**多副本前置条件**（缺一项就不要开多副本）

1. **应用必须无状态** — 不依赖本地内存 / 本地文件系统的会话或缓存。如果有，先迁到 Redis / 数据库
2. **健康检查正确** — `/health` 真实反映可服务能力（包括下游依赖检查），否则 readiness 让坏 pod 收流量
3. **外部依赖能扛住 N 倍连接** — Postgres 连接池、Redis、上游 API 配额按 `replicas × per-pod-pool-size` 估算
4. **没有"启动时单实例任务"** — 比如 DB migration、leader 选举抢锁等。这些应放到 init container 或 pre-deploy

**示例：按 ring 配副本**

```yaml
defaultConfig:
  replicas: 1                  # test 默认 1（成本优先）
specificConfig:
  - ring: staging
    replicas: 2                # staging 验证 HA 行为
  - ring: production
    replicas: 3                # 生产至少 3，容忍 1 节点故障 + 1 滚动更新
```

**HPA / 自动扩缩容（暂未支持）**

merlin 当前**只支持静态 `replicas`**，没有内置 HPA 字段。如需自动扩缩：

- CPU/内存 触发的 HPA：手写 `KubernetesManifest` 资源塞 raw `HorizontalPodAutoscaler` YAML
- 队列长度触发（推荐给 worker）：考虑部署 [KEDA](https://keda.sh/) 配 BullMQ trigger

后续版本计划在 `KubernetesApp` 加 `autoscaling: { minReplicas, maxReplicas, targetCPU }` 字段。

---

## 常见模式

### 模式 1：纯 Web 服务（有 Ingress，无认证）

```yaml
name: myapi
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.myapi-workload-sa
    isHardDependency: true

defaultConfig:
  namespace: myapi
  image: brainlysharedacr.azurecr.io/myapi:latest
  port: 8000
  serviceAccountName: myapi-workload-sa
  envVars:
    - APP_ENV=${ this.ring }
  ingress:
    subdomain: myapi
    dnsZone: thebrainly.dev
```

### 模式 2：Web 服务 + OAuth2 认证

主服务的 ingress 里加 auth annotations 和 oauth2-proxy 依赖：

```yaml
  ingress:
    subdomain: myapp
    dnsZone: thebrainly.dev
    annotations:
      nginx.ingress.kubernetes.io/auth-url: "https://$host/oauth2/auth"
      nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
      nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email"
    dependencies:
      - resource: KubernetesIngress.myapp-oauth2-proxy
        isHardDependency: true
```

还需要配套文件：`myappaad.yml`、`myappoauth2proxy.yml`、`myappoauth2proxysecretprovider.yml`。
用 `merlin init myapp --with-auth` 可以一次全部生成。

#### OAuth2 部署后的手动步骤

`merlin deploy --execute` 会自动完成大部分 AAD 配置（创建 App Registration、Service Principal、生成 client secret 并存入 Key Vault、设置 API 权限、尝试 admin consent）。但以下步骤**可能需要手动操作**：

**1. Admin Consent（管理员授权）**

Merlin 会自动尝试 `az ad app permission admin-consent`，但如果当前登录账号**不是全局管理员或特权角色管理员**，该命令会静默失败。此时需要让租户管理员手动授权：

- Azure Portal → App registrations → 你的应用 → API permissions → **"Grant admin consent for {tenant}"**
- 或让管理员运行：`az ad app permission admin-consent --id <appId>`

**2. 分配用户/组（必须手动）**

Merlin 会自动设置 `appRoleAssignmentRequired=true`，这意味着**只有被分配的用户/组才能登录**。部署后你必须手动添加允许登录的用户：

- Azure Portal → Enterprise applications → 你的应用 → Users and groups → **Add user/group**

> ⚠️ 如果跳过这一步，所有用户都会看到 "AADSTS50105: 管理员未授权你使用此应用" 错误。

**3. Redirect URI 必须三处一致**

以下三个文件中的域名**必须完全匹配**：

| 文件 | 字段 | 作用 |
|------|------|------|
| `myappaad.yml` | `webRedirectUris` | Azure AD 注册的回调地址 |
| `myappoauth2proxy.yml` | `OAUTH2_PROXY_REDIRECT_URL` 环境变量 | OAuth2 Proxy 的回调地址 |
| `myapp.yml` | `ingress.dnsZone` | 实际 DNS 路由 |

**4. DNS Zone 必须预先存在**

父 DNS Zone（如 `thebrainly.dev`）必须已在 Azure 中创建。如果不存在，部署会报错：

```bash
az network dns zone create --name thebrainly.dev --resource-group <your-rg>
```

**5. Key Vault 必须预先存在**

AAD 模板引用的 Key Vault（用于存放 client-secret 和 cookie-secret）必须已创建。通常通过共享基础设施部署：

```bash
merlin deploy shared-resource --ring test --region koreacentral --execute
```

**6. Key Vault Secrets 迁移**

如果从旧的 Key Vault 迁移到 Merlin 管理的新 Key Vault（如 `delta-test-krc-akv` → `brainlysharedtstkrcakv`），需要将 secrets 复制过去，否则 Pod 会因为 CSI SecretProviderClass 无法挂载 secret 而卡在 `ContainerCreating`：

```bash
# 复制所有 secrets（保留 secret 名称）
./scripts/migrate-kv-secrets.sh <旧-vault-名> <新-vault-名>

# 示例
./scripts/migrate-kv-secrets.sh delta-test-krc-akv brainlysharedtstkrcakv
```

> 脚本需要当前账号在源 vault 有 **Key Vault Secrets User** 角色，在目标 vault 有 **Key Vault Secrets Officer** 角色。

**6. Client Secret 轮换（长期维护）**

Client secret 仅在**首次部署**时自动创建（Azure 默认有效期 2 年），后续 update 不会重新生成。到期前需手动轮换：

```bash
az ad app credential reset --id <appId> --query password -o tsv
az keyvault secret set --vault-name <vault> --name <secret-name> --value <new-secret>
# 然后重启 OAuth2 Proxy Pod 使新 secret 生效
kubectl rollout restart deployment myapp-oauth2-proxy -n myapp
```

### 模式 3：后台 Worker（无 Ingress）

省略 `ingress` 就不会生成 Ingress，服务只在集群内部可访问：

```yaml
name: myworker
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.myworker-workload-sa
    isHardDependency: true

defaultConfig:
  namespace: myproject
  image: brainlysharedacr.azurecr.io/myworker:latest
  port: 3000
  healthPath: /health
  serviceAccountName: myworker-workload-sa
  envVars:
    - REDIS_URL=rediss://myredis:10000
```

### 模式 4：重资源服务（自定义资源限制 + 探针）

```yaml
defaultConfig:
  namespace: myapp
  image: brainlysharedacr.azurecr.io/myapp:latest
  port: 8000
  resources:
    cpuRequest: "1000m"
    memoryRequest: 2Gi
    cpuLimit: "4000m"
    memoryLimit: 8Gi
  probes:
    startup:
      httpGet: { path: /, port: 8000 }
      initialDelaySeconds: 1
      periodSeconds: 10
      timeoutSeconds: 30
      failureThreshold: 30
    liveness:
      httpGet: { path: /, port: 8000 }
      periodSeconds: 60
      timeoutSeconds: 30
      failureThreshold: 30
    readiness:
      httpGet: { path: /, port: 8000 }
      periodSeconds: 10
      timeoutSeconds: 30
      failureThreshold: 30
```

### 模式 5：不同环境使用不同的环境变量

有两种方式实现按 ring 区分环境变量。

**方式 1：用 `${ this.ring }` 动态引用（推荐，适合值有规律的场景）**

```yaml
defaultConfig:
  namespace: myapp
  image: brainlysharedacr.azurecr.io/myapp:latest
  port: 3000
  envVars:
    - APP_ENV=${ this.ring }                          # → test / staging / production
    - API_URL=https://api.${ this.ring }.example.com  # → api.test.example.com 等
    - KEY_VAULT_URL=${ AzureKeyVault.shared.url }     # 从其他资源动态获取
    - LOG_LEVEL=info                                  # 所有环境相同
```

**方式 2：用 specificConfig 按 ring 覆盖（适合值完全不同的场景）**

```yaml
defaultConfig:
  namespace: myapp
  image: brainlysharedacr.azurecr.io/myapp:latest
  port: 3000
  envVars:
    - APP_ENV=${ this.ring }
    - LOG_LEVEL=info

specificConfig:
  - ring: test
    envVars:                          # ⚠️ 数组完全替换，必须写全！
      - APP_ENV=${ this.ring }
      - LOG_LEVEL=debug               # test 用 debug
      - DB_HOST=testdb.postgres.database.azure.com
      - FEATURE_FLAG_NEW_UI=true
  - ring: staging
    envVars:
      - APP_ENV=${ this.ring }
      - LOG_LEVEL=info
      - DB_HOST=stagingdb.postgres.database.azure.com
      - FEATURE_FLAG_NEW_UI=false
  - ring: production
    envVars:
      - APP_ENV=${ this.ring }
      - LOG_LEVEL=warn                # production 用 warn
      - DB_HOST=proddb.postgres.database.azure.com
      - FEATURE_FLAG_NEW_UI=false
```

> ⚠️ **重要**：`envVars` 是数组，specificConfig 中会**完全替换** defaultConfig 的 envVars，不是追加。所以每个 ring 的 envVars 都要包含**所有**需要的变量。

**方式 3：用 ConfigMap 管理（适合变量很多的场景）**

当环境变量很多时，把它们放到 ConfigMap 里更清晰：

```yaml
# myappsharedconfig.yml
name: myapp-shared-config
type: KubernetesConfigMap

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true

defaultConfig:
  namespace: myapp
  data:
    APP_ENV: production
    LOG_LEVEL: info
    DB_HOST: proddb.postgres.database.azure.com
    FEATURE_FLAG_NEW_UI: "false"

specificConfig:
  - ring: test
    data:                              # 对象是深合并！只写需要覆盖的 key
      APP_ENV: test
      LOG_LEVEL: debug
      DB_HOST: testdb.postgres.database.azure.com
      FEATURE_FLAG_NEW_UI: "true"
  - ring: staging
    data:
      APP_ENV: staging
      DB_HOST: stagingdb.postgres.database.azure.com
```

然后在主服务里引用：

```yaml
# myapp.yml
defaultConfig:
  envFrom:
    - configMapRef: myapp-shared-config   # 所有 ConfigMap 的 key 自动变成环境变量
  envVars:
    - KEY_VAULT_URL=${ AzureKeyVault.shared.url }   # 不适合放 ConfigMap 的动态值
```

> **ConfigMap 的 `data` 是对象，specificConfig 会深合并**——只需要写要覆盖的 key，其他 key 保留。这比 `envVars`（数组，完全替换）方便很多。

---

## 配套资源文件

一个典型的 K8s 应用除了主 `KubernetesApp` 文件外，还需要以下配套文件。
`merlin init` 会自动生成这些文件。

### ServiceAccount（必需）

```yaml
name: myapp-workload-sa
type: KubernetesServiceAccount

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: AzureServicePrincipal.kv-workload
    isHardDependency: true

defaultConfig:
  namespace: myapp
  annotations:
    azure.workload.identity/client-id: ${ AzureServicePrincipal.kv-workload.clientId }
  labels:
    app.kubernetes.io/part-of: myapp
    managed-by: merlin
```

### SecretProviderClass（需要 Key Vault secrets 时）

> **注意**：如果应用不需要 Key Vault secrets，可以跳过此文件。`merlin init` 生成的 `{name}.yml` 中 `secretProvider` 和 `envFrom` 默认是注释掉的。

```yaml
name: myapp-secret-provider
type: KubernetesManifest

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.kv-workload
    isHardDependency: true
  - resource: AzureKeyVault.shared
    isHardDependency: true

defaultConfig:
  namespace: myapp
  manifest: |
    apiVersion: secrets-store.csi.x-k8s.io/v1
    kind: SecretProviderClass
    metadata:
      name: myapp-secret-provider
      namespace: myapp
    spec:
      provider: azure
      parameters:
        usePodIdentity: "false"
        useVMManagedIdentity: "false"
        clientID: ${ AzureServicePrincipal.kv-workload.clientId }
        keyvaultName: ${ AzureKeyVault.shared.name }
        tenantId: "YOUR_TENANT_ID"
        objects: |
          array:
            - |
              objectName: myapp-db-password
              objectType: secret
      secretObjects:
        - secretName: myapp-secrets
          type: Opaque
          data:
            - objectName: myapp-db-password
              key: DB_PASSWORD
```

### ConfigMap（多服务共享配置时）

```yaml
name: myapp-shared-config
type: KubernetesConfigMap

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true

defaultConfig:
  namespace: myapp
  data:
    NODE_ENV: production
    LOG_LEVEL: info
    API_BASE_URL: https://api.example.com

specificConfig:
  - ring: test
    data:
      NODE_ENV: development
      LOG_LEVEL: debug
      API_BASE_URL: https://api-test.example.com
```

---

## `${ }` 表达式

在 YAML 值中可以用 `${ }` 引用其他资源的导出值或当前资源的属性：

```yaml
# 引用当前资源的 ring/region
- APP_ENV=${ this.ring }
- APP_REGION=${ this.region }

# 引用其他资源的导出
- KEY_VAULT_URL=${ AzureKeyVault.shared.url }
- ACR_SERVER=${ AzureContainerRegistry.shared.server }
- AAD_CLIENT_ID=${ AzureServicePrincipal.myapp-aad.clientId }
- OIDC_ISSUER=${ KubernetesCluster.aks.oidcIssuerUrl }
```

部署时这些表达式会被解析为 shell 变量引用（如 `$MERLIN_AKV_SHARED_TST_KRC_URL`），通过 `az` 命令在运行时捕获实际值。

---

## merlin.yml 项目配置

每个 `merlin-resources/` 目录下必须有一个 `merlin.yml`：

```yaml
project: myapp          # 项目名，影响资源命名前缀和资源组名
ring:                   # 部署环境
  - test
  - staging
region:                 # 部署区域（省略则为全局资源）
  - koreacentral
  - eastasia
authProvider:           # 可选：目录级默认 authProvider
  name: AzureEntraID
```

`merlin.yml` 中的 `project`、`ring`、`region`、`authProvider` 会作为默认值应用到同目录下所有资源 YAML 文件，不需要在每个文件里重复声明。

---

## 文件命名约定

| 文件 | 命名规则 | 示例 |
|------|----------|------|
| 项目配置 | `merlin.yml` | `merlin.yml` |
| 主服务 | `{name}.yml` | `alluneed.yml`, `trinity-web.yml` |
| ServiceAccount | `{project}workloadsa.yml` | `alluneedworkloadsa.yml` |
| SecretProvider | `{project}secretprovider.yml` | `alluneedsecretprovider.yml` |
| AAD App | `{project}aad.yml` | `alluneedaad.yml` |
| OAuth2 Proxy | `{project}oauth2proxy.yml` | `alluneedoauth2proxy.yml` |
| ConfigMap | `{project}sharedconfig.yml` | `trinitysharedconfig.yml` |

文件名不影响功能（merlin 只看 YAML 内容），但建议统一风格方便维护。

---

## specificConfig 配置覆盖详解

`specificConfig` 用于按 ring/region 覆盖 `defaultConfig`。理解其**合并语义**非常重要：

### 匹配规则

```yaml
specificConfig:
  - ring: test                    # 仅匹配 test 环境
    cpuRequest: "100m"
  - region: koreacentral          # 仅匹配 koreacentral 区域
    location: koreacentral
  - ring: staging                 # 同时匹配 staging + eastasia
    region: eastasia
    replicas: 3
  - replicas: 5                   # 没有 ring/region → 匹配所有组合
```

### 合并语义（重要！）

| 数据类型 | 行为 | 说明 |
|----------|------|------|
| **对象** | 深合并 | specificConfig 的 key 覆盖 defaultConfig 同名 key，其他保留 |
| **数组** | 完全替换 | specificConfig 的数组**整个替换** defaultConfig 的同名数组 |
| **基本类型** | 替换 | 数字、字符串、布尔值直接覆盖 |

### 数组替换的陷阱

这是最常见的坑。当 `specificConfig` 覆盖一个数组字段时，必须**写完整内容**：

```yaml
# ❌ 错误！会丢失 defaultConfig 中的 probes、volumes 等
defaultConfig:
  containers:
    - name: app
      image: myapp:latest
      ports: [{containerPort: 3000}]
      probes: { ... }
      volumeMounts: [...]

specificConfig:
  - ring: staging
    containers:            # 这会完全替换 defaultConfig.containers！
      - name: app
        image: myapp:v2    # ⚠️ ports、probes、volumeMounts 全丢了

# ✅ 正确！覆盖数组时写完整内容
specificConfig:
  - ring: staging
    containers:
      - name: app
        image: myapp:v2
        ports: [{containerPort: 3000}]
        probes: { ... }        # 必须重写
        volumeMounts: [...]    # 必须重写
```

### 多个匹配按顺序应用

如果多个 `specificConfig` 条目都匹配当前 ring/region，它们按声明顺序依次应用，后面的覆盖前面的。

---

## 其他资源类型参考

`KubernetesApp` 适合大多数 Web 服务。但某些场景需要使用其他资源类型。

### KubernetesHelmRelease — Helm Chart 部署

用于安装 Helm chart（如 NGINX Ingress、cert-manager）：

```yaml
name: my-helm-release
type: KubernetesHelmRelease

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true

defaultConfig:
  namespace: my-namespace
  createNamespace: true           # 自动创建 namespace
  chart: ingress-nginx            # chart 名
  repoName: ingress-nginx         # Helm repo 名
  repoUrl: https://kubernetes.github.io/ingress-nginx  # Helm repo URL
  version: 4.12.2                 # chart 版本（推荐锁定）
  wait: true                      # 等待 Pod 就绪
  timeout: 10m                    # 超时时间

  # 通过 values 传递复杂配置（等同于 -f values.yaml）
  values:
    controller:
      replicaCount: 2
      service:
        annotations:
          service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path: /healthz

  # 通过 set 传递简单配置（等同于 --set key=value）
  set:
    - key: installCRDs
      value: "true"

  # 部署前执行的命令（常用于清理冲突的 webhook）
  preCommands:
    - kubectl delete validatingwebhookconfiguration cert-manager-webhook
```

### 原始 Kubernetes 资源类型

当 `KubernetesApp` 的抽象不够用时，可以直接使用底层类型：

| 类型 | 用途 | 何时使用 |
|------|------|----------|
| `KubernetesDeployment` | Deployment | 需要精细控制容器 spec（多容器、CSI volumes 等） |
| `KubernetesService` | Service | 单独管理 Service |
| `KubernetesIngress` | Ingress | 需要多 host/path 规则、DNS 绑定等高级配置 |
| `KubernetesNamespace` | Namespace | 需要单独管理 namespace |
| `KubernetesManifest` | 任意 K8s 清单 | SecretProviderClass 等非标准资源 |
| `KubernetesConfigMap` | ConfigMap | 共享配置 |
| `KubernetesServiceAccount` | ServiceAccount | Workload Identity |

**示例：原始 KubernetesDeployment**

```yaml
name: myapp-deployment
type: KubernetesDeployment

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true

defaultConfig:
  namespace: myapp
  appName: myapp
  replicas: 1
  serviceAccountName: myapp-workload-sa
  podLabels:
    azure.workload.identity/use: "true"
  containers:
    - name: app
      image: brainlysharedacr.azurecr.io/myapp:latest
      ports:
        - containerPort: 3000
      envFrom:
        - configMapRef:
            name: myapp-shared-config
        - secretRef:
            name: myapp-secrets
      volumeMounts:
        - name: secrets-store
          mountPath: /mnt/secrets-store
          readOnly: true
      startupProbe:
        httpGet: { path: /health, port: 3000 }
        initialDelaySeconds: 1
        periodSeconds: 1
        failureThreshold: 240
      livenessProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 10
        timeoutSeconds: 5
      readinessProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 5
        timeoutSeconds: 5
  volumes:
    - name: secrets-store
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: myapp-secret-provider
```

---

## exports 和 `${ }` 表达式进阶

### exports 字段

资源可以通过 `exports` 导出值，供其他资源通过 `${ }` 引用：

```yaml
# AzureKeyVault 导出 url 和 name
name: shared
type: AzureKeyVault
exports:
  url: AzureKeyVaultUrl
  name: AzureResourceName

# 其他资源引用
envVars:
  - KEY_VAULT_URL=${ AzureKeyVault.shared.url }
  - KEY_VAULT_NAME=${ AzureKeyVault.shared.name }
```

### 常用导出类型

| 导出类型 | 返回值 | 常用于 |
|----------|--------|--------|
| `AzureResourceName` | Azure 资源名 | 通用 |
| `AzureKeyVaultUrl` | Key Vault URI | 环境变量注入 |
| `AzureContainerRegistryServer` | ACR 登录地址 | 镜像拉取 |
| `AzureRedisEnterpriseUrl` | Redis 连接 URL | 环境变量注入 |
| `AzureServicePrincipalClientId` | SP 的 appId | Workload Identity |
| `AzureAKSOidcIssuerUrl` | AKS OIDC 签发 URL | 联合凭据 |
| `AzureADAppClientId` | AD App 的 clientId | OAuth2 |

### authProvider 模式

`authProvider` 控制资源间的权限关系。两种主要模式：

**AzureManagedIdentity — 基于角色的访问控制**

```yaml
# 让某资源以 Managed Identity 方式访问另一资源
authProvider:
  name: AzureManagedIdentity

dependencies:
  - resource: AzureBlobStorage.shared
    isHardDependency: true
    authProvider:
      name: AzureManagedIdentity
      role: Storage Blob Data Contributor   # Azure RBAC 角色
      scope: resource                        # 作用域限定到目标资源
```

**AzureEntraID — Azure AD 认证**

```yaml
# 服务主体，用于 Workload Identity、OAuth2 等
authProvider:
  name: AzureEntraID
```

> 对于 Kubernetes 资源类型（`KubernetesDeployment`、`KubernetesService` 等），不需要 `authProvider`，因为它们通过 `kubectl` 部署，不涉及 Azure RBAC。
