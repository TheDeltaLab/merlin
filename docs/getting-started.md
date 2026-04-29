# Merlin 项目接入指南

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md) | [遗留资源](legacy-resources.md)

## 快速开始

### 1. 安装 Merlin

```bash
# 克隆并全局安装（一次性）
git clone https://github.com/TheDeltaLab/merlin.git
cd merlin && pnpm install && pnpm link:global

# 验证
merlin --version   # 应输出 1.9.0+
```

### 2. 初始化项目资源

在你的项目根目录下运行：

```bash
# Web 服务（默认，带 Ingress）
merlin init myapp

# Web 服务 + OAuth2 认证（Azure AD）
merlin init myapp --with-auth

# 后台 Worker（无 Ingress）
merlin init myworker --template worker

# 纯 API（有 Ingress，无 OAuth2 注解）
merlin init myapi --template api

# 最小配置（仅 merlin.yml + 主服务 yml）
merlin init myapp --template minimal
```

这会生成 `merlin-resources/` 目录，按模板包含 2-7 个 YAML 文件。

---

## `merlin init` 生成文件详解

### 文件总览

不同模板生成的文件集如下：

| # | 文件 | `minimal` | `worker` | `api` | `web` | `web --with-auth` | 作用 |
|---|------|:---------:|:--------:|:-----:|:-----:|:-----------------:|------|
| 1 | `merlin.yml` | ✅ | ✅ | ✅ | ✅ | ✅ | 项目配置（ring/region 默认值） |
| 2 | `{name}.yml` | ✅ | ✅ | ✅ | ✅ | ✅ | 主服务（KubernetesApp） |
| 3 | `{name}workloadsa.yml` | — | ✅ | ✅ | ✅ | ✅ | ServiceAccount（Workload Identity） |
| 4 | `{name}secretprovider.yml` | — | ✅ | ✅ | ✅ | ✅ | Key Vault → Pod 的 Secret 桥接 |
| 5 | `{name}aad.yml` | — | — | — | — | ✅ | Azure AD App Registration |
| 6 | `{name}oauth2proxy.yml` | — | — | — | — | ✅ | OAuth2 Proxy 服务 |
| 7 | `{name}oauth2proxysecretprovider.yml` | — | — | — | — | ✅ | OAuth2 Proxy 的 Secret 桥接 |

以下以 `merlin init myapp` (web 模板) 为例，逐个说明每个文件的作用和配置方法。

---

### 文件 1：`merlin.yml` — 项目配置

```yaml
project: myapp
ring:
  - test
  - staging
region:
  - koreacentral  # TODO: Change to your Azure region
```

**这不是一个资源文件**（没有 `type` 字段）。它为同目录下所有资源 YAML 提供默认值。

#### 配置指南

| 字段 | 说明 | 如何配置 |
|------|------|----------|
| `project` | 项目名，影响 Azure 资源组名、K8s namespace 等命名前缀 | 保持和 `merlin init` 传入的名字一致 |
| `ring` | 部署环境列表。Merlin 会为每个 ring 生成独立的资源实例 | 按需选择 `test`、`staging`、`production` |
| `region` | 部署区域列表。和 ring 做笛卡尔积（2 ring × 2 region = 4 组资源） | 改为你的 Azure 区域，如 `eastus`、`eastasia` |
| `authProvider` | 可选，目录级默认认证方式 | K8s 资源不需要，Azure 资源按需添加 |

**常见调整：**

```yaml
# 单 ring 单 region（最简单，开发阶段推荐）
project: myapp
ring:
  - test
region:
  - koreacentral

# 多 ring 多 region（完整生产部署）
project: myapp
ring:
  - test
  - staging
  - production
region:
  - koreacentral
  - eastasia
```

> **提示**：`ring` 和 `region` 支持缩写（`tst`/`stg`/`prd`、`krc`/`eas` 等），但建议在 YAML 中使用全名。

---

### 文件 2：`{name}.yml` — 主服务 (KubernetesApp)

这是最核心的文件。`KubernetesApp` 是一个**编译时复合类型**，会自动展开为：
- `KubernetesDeployment`（总是生成）
- `KubernetesService`（总是生成，ClusterIP）
- `KubernetesIngress`（有 `ingress` 配置时才生成）

#### web 模板生成的内容

```yaml
name: myapp
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true

defaultConfig:
  namespace: myapp
  image: myregistry.azurecr.io/myapp:latest  # TODO: Change to your ACR and image
  port: 3000  # TODO: Change to your port
  serviceAccountName: myapp-workload-sa
  # secretProvider: myapp-secret-provider  # TODO: Uncomment after adding secrets to Key Vault
  # envFrom:                                # TODO: Uncomment after adding secrets to Key Vault
  #   - secretRef: myapp-secrets
  envVars:
    - APP_ENV=${ this.ring }
  ingress:
    subdomain: myapp
    dnsZone: example.com  # TODO: Change to your DNS zone
```

> **注意**：`secretProvider` 和 `envFrom` 默认是注释掉的。只有在 Key Vault 中创建了对应的 secrets 后才需要取消注释。如果你的应用不需要 Key Vault secrets，可以直接删掉 `{name}secretprovider.yml`。

#### 配置指南

**必须修改（TODO 项）：**

| 字段 | 修改为 | 示例 |
|------|--------|------|
| `image` | 你的 ACR 地址和镜像名 | `brainlysharedacr.azurecr.io/myapp:latest` |
| `port` | 你的应用实际监听端口 | `8000` |
| `ingress.dnsZone` | 你的 DNS zone | `thebrainly.dev` |

**按需调整：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `namespace` | 与项目名相同 | K8s namespace，通常不需要改 |
| `ingress.subdomain` | 与项目名相同 | 默认域名 = `{subdomain}.{ring}.{dnsZone}`，如 `myapp.staging.thebrainly.dev` |
| `ingress.host` | 自动拼接 | 可选：自定义 host 模板，如 `${ this.ring }.myapp.thebrainly.dev`，覆盖自动拼接 |
| `envVars` | `APP_ENV=${ this.ring }` | 根据需要添加更多环境变量 |
| `envFrom` | 注释状态 | 取消注释后对应 SecretProviderClass 生成的 K8s Secret |
| `serviceAccountName` | `{name}-workload-sa` | 对应 workloadsa.yml 中的 ServiceAccount |
| `secretProvider` | 注释状态 | 取消注释后对应 secretprovider.yml 中的 SecretProviderClass |

**省略的字段会用默认值：**

| 字段 | 默认值 |
|------|--------|
| `replicas` | `1` |
| `healthPath` | `/`（用于 liveness/readiness/startup 探针） |
| `resources.cpuRequest` / `cpuLimit` | `100m` / `500m` |
| `resources.memoryRequest` / `memoryLimit` | `512Mi` / `1Gi` |
| `ingress.path` | `/` |
| `ingress.clusterIssuer` | `letsencrypt-prod` |
| `ingress.ingressClassName` | `nginx` |
| `ingress.bindDnsZone` | `true`（自动创建 DNS A 记录） |

**worker 模板的区别**：没有 `ingress` 块，服务只在集群内部可访问。

**web --with-auth 模板的区别**：`ingress` 中多了 OAuth2 注解和 OAuth2 Proxy 的依赖，`dependencies` 多了 AAD 依赖。

---

### 文件 3：`{name}workloadsa.yml` — ServiceAccount (Workload Identity)

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

**这个文件的作用：** 创建一个 K8s ServiceAccount，并通过 Azure Workload Identity 注解把它和 Azure Service Principal 绑定。Pod 使用这个 SA 后就能无密码访问 Key Vault。

#### 配置指南

| 字段 | 是否需要修改 | 说明 |
|------|:----------:|------|
| `name` | ❌ | 自动命名为 `{project}-workload-sa`，与主服务的 `serviceAccountName` 对应 |
| `namespace` | ❌ | 与主服务一致 |
| `dependencies` | ❌ | 依赖共享的 AKS 集群和 KV workload SP，不需要改 |
| `annotations` | ❌ | `${ }` 表达式会在部署时自动解析为实际的 SP client ID |
| `labels` | 可选 | 可以按需添加自定义 label |

> **通常不需要修改这个文件。** 所有动态值都通过 `${ }` 表达式自动解析。

#### 依赖关系说明

- **`KubernetesCluster.aks`**：共享 AKS 集群（来自 `shared-k8s-resource/`），必须先存在
- **`AzureServicePrincipal.kv-workload`**：共享 Key Vault 工作负载 SP（来自 `shared-k8s-resource/`），为 Pod 提供 Key Vault 访问权限

---

### 文件 4：`{name}secretprovider.yml` — SecretProviderClass (Key Vault → Pod)

> **注意**：此文件仅在应用需要从 Key Vault 读取 secrets 时才需要。如果暂时不需要，可以直接删掉。

```yaml
# NOTE: This file is only needed if your app reads secrets from Azure Key Vault.
# Before deploying, make sure:
#   1. The secrets listed below actually exist in the Key Vault
#   2. The kv-workload SP has a federated credential for your ServiceAccount
#      (add it to shared-k8s-resource/sharedkvsp.yml in the merlin repo)
#   3. Uncomment secretProvider and envFrom in myapp.yml
# If your app doesn't need secrets yet, you can safely delete this file.

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
        tenantId: "YOUR_AZURE_AD_TENANT_ID"  # TODO
        objects: |
          array:
            - |
              objectName: myapp-example-secret
              objectType: secret
      secretObjects:
        - secretName: myapp-secrets
          type: Opaque
          data:
            - objectName: myapp-example-secret
              key: EXAMPLE_SECRET
```

**这个文件的作用：** 声明一个 CSI SecretProviderClass，将 Azure Key Vault 中的 secrets 同步到 K8s Secret，让 Pod 通过 `envFrom.secretRef` 注入环境变量。

**数据流向：** `Azure Key Vault` → `CSI SecretProviderClass` → `K8s Secret` → `Pod 环境变量`

#### 配置指南

**必须修改：**

| 位置 | 修改为 | 说明 |
|------|--------|------|
| `tenantId` | 你的 Azure AD 租户 ID | 格式：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `objects.array` | 你实际要用的 Key Vault secret 名 | 每个 secret 一个条目 |
| `secretObjects.data` | Key Vault secret 名 → 环境变量名的映射 | `objectName` 对应 KV secret，`key` 对应环境变量名 |

**不需要修改：**
- `clientID`、`keyvaultName` — 通过 `${ }` 自动解析
- `dependencies` — 声明正确的依赖顺序

#### 实际配置示例

假设你的应用需要数据库密码和 API key：

```yaml
        objects: |
          array:
            - |
              objectName: myapp-db-password
              objectType: secret
            - |
              objectName: myapp-api-key
              objectType: secret
      secretObjects:
        - secretName: myapp-secrets
          type: Opaque
          data:
            - objectName: myapp-db-password
              key: DB_PASSWORD
            - objectName: myapp-api-key
              key: API_KEY
```

这样 Pod 里就能通过 `DB_PASSWORD` 和 `API_KEY` 环境变量读取 Key Vault 中的 secret。

> **前提：** 对应的 secret 必须已存在于 Azure Key Vault 中。可以手动创建：
> ```bash
> az keyvault secret set --vault-name <vault-name> --name myapp-db-password --value "your-password"
> ```

#### `secretObjects` 中 `secretName` 的关系

`secretName: myapp-secrets` 对应主服务 `{name}.yml` 中的 `envFrom.secretRef: myapp-secrets`。如果改了这里的名字，主服务的 `envFrom` 也要同步修改。

---

### 文件 5：`{name}aad.yml` — Azure AD App Registration（仅 `--with-auth`）

```yaml
name: myapp-aad
type: AzureServicePrincipal
region: none

authProvider:
  name: AzureEntraID

dependencies:
  - resource: AzureKeyVault.shared
    isHardDependency: true

defaultConfig:
  displayName: myapp-aad-${ this.ring }
  webRedirectUris:
    - https://myapp.${ this.ring }.example.com/oauth2/callback  # TODO
  assignmentRequired: true
  apiPermissions: oidc

specificConfig:
  - ring: test
    clientSecretKeyVault:
      vaultNames:
        - YOUR_TEST_KEYVAULT_NAME  # TODO
      secretName: myapp-oauth2-proxy-client-secret
    cookieSecretKeyVault:
      vaultNames:
        - YOUR_TEST_KEYVAULT_NAME  # TODO
      secretName: myapp-oauth2-proxy-cookie-secret
  - ring: staging
    clientSecretKeyVault:
      vaultNames:
        - YOUR_STAGING_KEYVAULT_NAME  # TODO
      secretName: myapp-oauth2-proxy-client-secret
    cookieSecretKeyVault:
      vaultNames:
        - YOUR_STAGING_KEYVAULT_NAME  # TODO
      secretName: myapp-oauth2-proxy-cookie-secret

exports:
  clientId: AzureServicePrincipalClientId
```

**这个文件的作用：** 创建 Azure AD App Registration + Service Principal，用于 OAuth2 认证。自动生成 client secret 并存入 Key Vault。

#### 配置指南

**必须修改：**

| 字段 | 修改为 | 示例 |
|------|--------|------|
| `webRedirectUris` 中的域名 | 你的实际域名 | `https://myapp.${ this.ring }.thebrainly.dev/oauth2/callback` |
| `specificConfig` 中所有 `vaultNames` | 各 ring 对应的 Key Vault 名 | `brainlysharedtstkrcakv`（test）、`brainlysharedstgkrcakv`（staging） |

**不需要修改：**

| 字段 | 说明 |
|------|------|
| `region: none` | AAD App 是全局资源，不绑定区域 |
| `displayName` | 自动包含 ring 名，部署时解析 `${ this.ring }` |
| `assignmentRequired: true` | 限制只有被分配的用户才能登录 |
| `apiPermissions: oidc` | 请求 OpenID Connect 标准权限 |
| `exports.clientId` | 导出 SP 的 appId，供 OAuth2 Proxy 引用 |

**关键提示：**

- **`clientSecretKeyVault.vaultNames`**：指定将自动生成的 client secret 存入哪个 Key Vault。只有首次部署时才会生成 secret，后续更新不会重新生成
- **`cookieSecretKeyVault`**：OAuth2 Proxy 用于加密 cookie 的 secret，同样只在首次部署时生成
- **`secretName`**：Key Vault 中的 secret 名称，必须和 OAuth2 Proxy 的 SecretProviderClass 中的 `objectName` 一致

#### 域名一致性要求

以下三处的域名**必须完全匹配**：

| 文件 | 字段 |
|------|------|
| `{name}aad.yml` | `webRedirectUris` |
| `{name}oauth2proxy.yml` | `OAUTH2_PROXY_REDIRECT_URL` 环境变量 |
| `{name}.yml` | `ingress.dnsZone`（决定实际路由域名） |

---

### 文件 6：`{name}oauth2proxy.yml` — OAuth2 Proxy 服务（仅 `--with-auth`）

```yaml
name: myapp-oauth2-proxy
type: KubernetesApp

dependencies:
  - resource: KubernetesManifest.myapp-oauth2-proxy-secret-provider
    isHardDependency: true
  - resource: KubernetesServiceAccount.myapp-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.myapp-aad
    isHardDependency: true

defaultConfig:
  namespace: myapp
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1
  port: 4180
  serviceAccountName: myapp-workload-sa
  secretProvider: myapp-oauth2-proxy-secret-provider
  resources:
    cpuRequest: "100m"
    memoryRequest: "128Mi"
    cpuLimit: "200m"
    memoryLimit: "256Mi"
  probes:
    liveness: false
    startup: false
    readiness:
      httpGet:
        path: /ping
        port: 4180
  envFrom:
    - secretRef: myapp-oauth2-proxy-secrets
  envVars:
    - OAUTH2_PROXY_PROVIDER=oidc
    - OAUTH2_PROXY_OIDC_ISSUER_URL=https://login.microsoftonline.com/YOUR_AZURE_AD_TENANT_ID/v2.0  # TODO
    - OAUTH2_PROXY_CLIENT_ID=${ AzureServicePrincipal.myapp-aad.clientId }
    - OAUTH2_PROXY_REDIRECT_URL=https://myapp.${ this.ring }.example.com/oauth2/callback  # TODO
    - OAUTH2_PROXY_UPSTREAM=static://202
    - OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180
    - OAUTH2_PROXY_EMAIL_DOMAINS=*
    - OAUTH2_PROXY_SCOPE=openid email profile
    - OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true
    - OAUTH2_PROXY_PASS_ACCESS_TOKEN=true
    - OAUTH2_PROXY_OIDC_EMAIL_CLAIM=preferred_username
    - OAUTH2_PROXY_SET_XAUTHREQUEST=true
  ingress:
    subdomain: myapp
    dnsZone: example.com  # TODO
    path: /oauth2
    bindDnsZone: false
    annotations:
      nginx.ingress.kubernetes.io/proxy-buffer-size: "8k"
      nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
```

**这个文件的作用：** 部署 OAuth2 Proxy 作为认证网关。它作为 NGINX Ingress 的 forward-auth 后端，拦截所有请求并重定向到 Azure AD 登录页。

#### 配置指南

**必须修改：**

| 字段 | 修改为 | 说明 |
|------|--------|------|
| `OAUTH2_PROXY_OIDC_ISSUER_URL` 中的租户 ID | 你的 Azure AD 租户 ID | 格式：`https://login.microsoftonline.com/{tenant-id}/v2.0` |
| `OAUTH2_PROXY_REDIRECT_URL` 中的域名 | 你的实际域名 | 必须和 `aad.yml` 中的 `webRedirectUris` 一致 |
| `ingress.dnsZone` | 你的 DNS zone | 必须和主服务的 `ingress.dnsZone` 一致 |

**通常不需要修改：**

| 字段 | 说明 |
|------|------|
| `image` | OAuth2 Proxy 官方镜像，有新版本时可以升级 |
| `port: 4180` | OAuth2 Proxy 默认端口 |
| `resources` | 轻量代理，128Mi 内存足够 |
| `probes` | 只保留 readiness（`/ping`），liveness 和 startup 禁用 |
| `ingress.path: /oauth2` | 只处理 `/oauth2/*` 路径（登录回调、认证端点） |
| `ingress.bindDnsZone: false` | 不单独创建 DNS 记录，复用主服务的域名 |
| `OAUTH2_PROXY_UPSTREAM=static://202` | 返回 202 表示认证成功（forward-auth 模式） |
| `OAUTH2_PROXY_EMAIL_DOMAINS=*` | 允许所有邮箱域（通过 `assignmentRequired` 在 AAD 层面控制） |
| `OAUTH2_PROXY_OIDC_EMAIL_CLAIM=preferred_username` | Azure AD 的 id_token 默认不含 `email` claim，用 `preferred_username` 代替 |
| `OAUTH2_PROXY_SET_XAUTHREQUEST=true` | 将认证信息传递到后端（`X-Auth-Request-User` 等 header） |

#### 工作原理

```
用户请求 → NGINX Ingress
  ↓ auth-url annotation
OAuth2 Proxy (/oauth2/auth)
  ├─ 已认证 → 返回 202 → NGINX 转发到主服务
  └─ 未认证 → 302 到 Azure AD 登录页
       ↓ 登录成功
  Azure AD → /oauth2/callback → 设置 cookie → 重定向回原始页面
```

---

### 文件 7：`{name}oauth2proxysecretprovider.yml` — OAuth2 Proxy Secrets（仅 `--with-auth`）

```yaml
name: myapp-oauth2-proxy-secret-provider
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
      name: myapp-oauth2-proxy-secret-provider
      namespace: myapp
    spec:
      provider: azure
      parameters:
        usePodIdentity: "false"
        useVMManagedIdentity: "false"
        clientID: ${ AzureServicePrincipal.kv-workload.clientId }
        keyvaultName: ${ AzureKeyVault.shared.name }
        tenantId: "YOUR_AZURE_AD_TENANT_ID"  # TODO
        objects: |
          array:
            - |
              objectName: myapp-oauth2-proxy-client-secret
              objectType: secret
            - |
              objectName: myapp-oauth2-proxy-cookie-secret
              objectType: secret
      secretObjects:
        - secretName: myapp-oauth2-proxy-secrets
          type: Opaque
          data:
            - objectName: myapp-oauth2-proxy-client-secret
              key: OAUTH2_PROXY_CLIENT_SECRET
            - objectName: myapp-oauth2-proxy-cookie-secret
              key: OAUTH2_PROXY_COOKIE_SECRET
```

**这个文件的作用：** 和文件 4 类似，但专门为 OAuth2 Proxy 服务提供 secret。从 Key Vault 获取 client secret 和 cookie secret，映射为环境变量注入 OAuth2 Proxy Pod。

#### 配置指南

**必须修改：**

| 字段 | 修改为 |
|------|--------|
| `tenantId` | 你的 Azure AD 租户 ID |

**不需要修改：**
- `objects` 中的 `objectName` — 必须与 `aad.yml` 中 `clientSecretKeyVault.secretName` 和 `cookieSecretKeyVault.secretName` 一致（默认已对齐）
- `secretObjects` 中的 `key` — 是 OAuth2 Proxy 约定的环境变量名（`OAUTH2_PROXY_CLIENT_SECRET`、`OAUTH2_PROXY_COOKIE_SECRET`）

> **注意：** 这些 secret 由 `merlin deploy` 首次部署 `aad.yml` 时自动创建并存入 Key Vault，不需要手动创建。

---

### 文件间的依赖关系

以下是 `web --with-auth` 模板所有 7 个文件的完整依赖图（`→` 表示"依赖于"）：

```
merlin.yml (提供 project/ring/region 默认值，非资源)
    │
    ├── myapp.yml (KubernetesApp)
    │     → KubernetesServiceAccount.myapp-workload-sa
    │     → AzureServicePrincipal.myapp-aad (auth only)
    │     └── ingress → KubernetesIngress.myapp-oauth2-proxy (auth only)
    │
    ├── myappworkloadsa.yml (KubernetesServiceAccount)
    │     → KubernetesCluster.aks ←(共享资源)
    │     → AzureServicePrincipal.kv-workload ←(共享资源)
    │
    ├── myappsecretprovider.yml (KubernetesManifest)
    │     → KubernetesCluster.aks ←(共享资源)
    │     → KubernetesServiceAccount.myapp-workload-sa
    │     → AzureServicePrincipal.kv-workload ←(共享资源)
    │     → AzureKeyVault.shared ←(共享资源)
    │
    ├── myappaad.yml (AzureServicePrincipal)
    │     → AzureKeyVault.shared ←(共享资源)
    │
    ├── myappoauth2proxy.yml (KubernetesApp)
    │     → KubernetesManifest.myapp-oauth2-proxy-secret-provider
    │     → KubernetesServiceAccount.myapp-workload-sa
    │     → AzureServicePrincipal.myapp-aad
    │
    └── myappoauth2proxysecretprovider.yml (KubernetesManifest)
          → KubernetesCluster.aks ←(共享资源)
          → KubernetesServiceAccount.myapp-workload-sa
          → AzureServicePrincipal.kv-workload ←(共享资源)
          → AzureKeyVault.shared ←(共享资源)
```

标注为 **←(共享资源)** 的依赖来自 `shared-resource/` 和 `shared-k8s-resource/` 目录，编译时由 Merlin 自动包含。

### 最小修改清单

初始化后，**必须修改**的 TODO 项汇总：

| 模板 | 必须修改的 TODO | 文件 |
|------|----------------|------|
| 所有模板 | ACR 镜像地址 | `{name}.yml` |
| 所有模板 | 应用端口 | `{name}.yml` |
| 所有模板 | Azure region | `merlin.yml` |
| `web`/`api` | DNS zone | `{name}.yml` |
| `worker`/`web`/`api` | Azure AD 租户 ID | `{name}secretprovider.yml` |
| `worker`/`web`/`api` | Key Vault 中的 secret 名和映射 | `{name}secretprovider.yml` |
| `worker`/`web`/`api` | 取消注释 secretProvider 和 envFrom（需要 secrets 时） | `{name}.yml` |
| `--with-auth` | Azure AD 租户 ID ×3 处 | `{name}secretprovider.yml`、`{name}oauth2proxy.yml`、`{name}oauth2proxysecretprovider.yml` |
| `--with-auth` | 域名 ×3 处（必须一致） | `{name}aad.yml`、`{name}oauth2proxy.yml`、`{name}.yml` |
| `--with-auth` | Key Vault 名（每个 ring 各一个） | `{name}aad.yml` |

**共享资源配置（在 merlin 仓库中操作）：**

| 模板 | 必须配置 | 文件 |
|------|---------|------|
| `worker`/`web`/`api` | 添加 ServiceAccount 的 federated credential | `shared-k8s-resource/sharedkvsp.yml` |
| 所有需要 CI/CD 的模板 | 添加 GitHub repo 的 federated credential | `shared-resource/sharedgithubsp.yml` |
| 所有需要 CI/CD 的模板 | 配置 GitHub Secrets/Variables | 见「新项目接入共享资源清单」 |

---

### 3. 编辑 TODO 占位符

生成的文件中有 `# TODO` 注释标记需要替换的值：

| 占位符 | 替换为 | 示例 |
|--------|--------|------|
| `myregistry.azurecr.io` | 共享 ACR 地址 | `brainlysharedacr.azurecr.io` |
| `example.com` | 你的 DNS zone | `thebrainly.dev` |
| `YOUR_AZURE_AD_TENANT_ID` | Azure AD 租户 ID | `2c10b0b9-d9c1-4c81-85ee-...` |
| `port: 3000` | 你的应用端口 | `port: 8000` |

### 4. 部署

```bash
# 预览命令（dry-run）
merlin deploy ./merlin-resources --ring test --region koreacentral

# 真正执行
merlin deploy ./merlin-resources --ring test --region koreacentral --execute
```

> **项目不需要安装任何 npm 依赖。** Python、Go、Java 项目都可以直接用全局 `merlin` 命令。

---

## 上线生产前 checklist

`merlin init` 生成的配置默认面向 dev/test。**正式投到 production 前**，逐项确认：

### 副本数与可用性

- [ ] **用户面向应用（web/admin/home）配 `replicas: 2+`** — `defaultConfig.replicas` 默认是 1，单副本意味着 pod 重启 / 节点维护期间整个服务 503。建议在 `specificConfig` 按 ring 区分：
  ```yaml
  specificConfig:
    - ring: staging
      replicas: 2
    - ring: production
      replicas: 3
  ```
- [ ] **内部 API（lance、gateway 等）至少考虑 `replicas: 2`**，看流量定
- [ ] **异步 worker 暂时单副本**（HPA 还未支持，按队列堆积情况手动调）
- [ ] **健康检查路径正确** — `healthPath` 必须返回 200，且应反映"真实可服务能力"（包含下游依赖检查），不要用永远返回 200 的桩
- [ ] **应用必须无状态** — 不依赖本地内存/磁盘的会话或缓存，否则不能多副本

副本数推荐表和决策依据见 [KubernetesApp YAML 参考 → 副本数推荐](kubernetes-app-reference.md#副本数推荐)。

### 资源与扩展

- [ ] **resources 设置合理** — 按实际负载估算 `cpuRequest/memoryRequest`，prod 不要直接用模板默认值
- [ ] **依赖资源能扛住 N 倍连接** — Postgres 连接池、Redis、上游 API 配额要按 `replicas × 单 pod 池大小` 评估
- [ ] **生产 ring 在 `merlin.yml` 列出** — 默认模板只有 test，prod 需手动加 `ring: [test, staging, production]`

### 安全

- [ ] **公网入口必须有认证** — 用户面向应用走 oauth2-proxy（`--with-auth` 模板自动配好）；webhook/回调端点用共享 secret
- [ ] **Key Vault 联邦凭证已配** — 本项目 ServiceAccount 已加到 `shared-k8s-resource/sharedkvsp.yml`，且 merlin 已重新部署 shared SP（见 [排错指南](troubleshooting.md)）
- [ ] **GitHub SP 联邦凭证已配** — 本项目 GitHub Actions workflow 已加到 `sharedgithubsp.yml`

### 部署流程

- [ ] **CI/CD 配通** — 见 [CI/CD 指南](cicd-guide.md)，至少 `nightly` build 自动推 ACR
- [ ] **先 dry-run 再 execute** — `merlin deploy --ring production --region <region>` 确认输出无误后再加 `--execute`
- [ ] **观察 5 分钟** — `kubectl get pods -n <namespace>` 确认所有副本都 Ready，无 CrashLoopBackOff

---

## 下一步

- **详细字段说明** → [KubernetesApp YAML 参考](kubernetes-app-reference.md)
- **CI/CD 自动化** → [CI/CD 指南](cicd-guide.md)
- **CLI 命令** → [CLI 参考](cli-reference.md)
- **遇到问题？** → [排错指南](troubleshooting.md) | [遗留资源](legacy-resources.md)
