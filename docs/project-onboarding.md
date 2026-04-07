# Merlin 项目接入指南

## 快速开始

### 1. 安装 Merlin

```bash
# 克隆并全局安装（一次性）
git clone https://github.com/TheDeltaLab/merlin.git
cd merlin && pnpm install && pnpm link:global

# 验证
merlin --version   # 应输出 1.4.0+
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
| `resources.cpuRequest` / `cpuLimit` | `250m` / `500m` |
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
    - OAUTH2_PROXY_SCOPE=openid profile email
    - OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true
    - OAUTH2_PROXY_PASS_ACCESS_TOKEN=true
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

## KubernetesApp YAML 完整参考

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
| `replicas` | `1` | |
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

## CLI 完整参考

### merlin init — 初始化项目

```bash
merlin init [name] [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `[name]` | 项目名 | 当前目录名 |
| `-t, --template <type>` | 模板类型：`web`、`worker`、`api`、`minimal` | `web` |
| `--with-auth` | 包含 OAuth2 Proxy + Azure AD 资源（仅对 `web` 模板生效） | `false` |
| `--dir <path>` | 输出目录 | `./merlin-resources` |

各模板生成的文件数：

| 模板 | 文件数 | 包含 Ingress | 包含 Auth |
|------|--------|-------------|-----------|
| `minimal` | 2 | 否 | 否 |
| `worker` | 4 | 否 | 否 |
| `api` | 4 | 是 | 否 |
| `web` | 4 | 是 | 否 |
| `web --with-auth` | 7 | 是 | 是 |

> **注意**：如果目标目录已存在 `merlin.yml`，init 会退出不覆盖。要重新生成，先删除已有文件。

### merlin compile — 编译 YAML 到 TypeScript

```bash
merlin compile [path] [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `[path]` | YAML 文件或目录路径 | `./merlin-resources` |
| `-i, --input <path>` | 覆盖路径参数 | — |
| `--also <paths...>` | 额外资源目录（可重复，逗号分隔） | — |
| `-o, --output <path>` | 输出目录 | `.merlin` |
| `-w, --watch` | 监听文件变化自动重编译 | `false` |
| `--validate-only` | 仅验证 YAML，不生成代码 | `false` |
| `--no-cache` | 跳过缓存，强制重编译 | `false` |
| `--no-shared` | 不自动包含 shared resources | `false` |

### merlin deploy — 部署资源

```bash
merlin deploy [path] [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `[path]` | 资源目录路径 | `./merlin-resources` |
| `-i, --input <path>` | 覆盖路径参数 | — |
| `--also <paths...>` | 额外资源目录 | — |
| `-e, --execute` | 真正执行（默认 dry-run） | `false` |
| `-r, --ring <ring>` | 目标环境 | merlin.yml 中第一个 |
| `--region <region>` | 目标区域 | merlin.yml 中第一个 |
| `-o, --output-file <file>` | 将命令写入 shell 脚本 | — |
| `-c, --concurrency <n>` | DAG 每层最大并行数 | `4` |
| `--cloud <cloud>` | 云厂商：`azure`、`alibaba` | `azure` |
| `--no-shared` | 不自动包含 shared resources | `false` |
| `--all` | 确认部署到所有环境 | `false` |
| `-y, --yes` | 跳过交互确认（CI/CD 用） | `false` |

**安全规则**：

| 场景 | 行为 |
|------|------|
| 不加 `--execute` | 始终 dry-run，打印命令不执行 |
| `--execute --ring test` | 直接执行 |
| `--execute --ring staging` | 直接执行 |
| `--execute --ring production` | 交互确认，需输入 "yes" |
| `--execute` 不指定 ring | 拒绝，提示加 `--all` |
| `--execute --ring production --yes` | 跳过确认（CI 模式） |

> **deploy 会自动先编译**，不需要手动先运行 `merlin compile`。

### merlin validate — 验证资源

```bash
merlin validate [path] [options]
```

与 `compile` 相同的选项（`--also`、`--no-shared`）。验证通过输出 `✅ All resources are valid`，失败输出结构化错误和修复提示。

### merlin list — 列出资源及状态

```bash
merlin list [path] [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `-r, --ring <ring>` | 按环境过滤 | merlin.yml 中第一个 |
| `--region <region>` | 按区域过滤 | merlin.yml 中第一个 |
| `--no-status` | 跳过云端状态查询（快速模式） | `false` |
| `--json` | JSON 格式输出 | `false` |

会查询实际 Azure/K8s 状态，显示 `✅`/`❌`/`⚠️` 图标。

### merlin prerequisites — 检查依赖工具

```bash
merlin prerequisites [--install]
```

检查 `az`、`helm`、`kubectl` 是否安装。加 `--install` 自动通过 Homebrew 安装（仅 macOS）。

### Ring/Region 缩写

所有命令支持全名和缩写：

| 全名 | 缩写 |
|------|------|
| `test` | `tst` |
| `staging` | `stg` |
| `production` | `prd` |
| `koreacentral` | `krc` |
| `eastasia` | `eas` |
| `eastus` | `eus` |
| `westus` | `wus` |

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

---

## GitHub Actions CI/CD 配置

### 概述

Merlin 创建的 `AzureServicePrincipal`（在 `shared-resource/sharedgithubsp.yml` 中定义）为 GitHub Actions 提供了 OIDC 联合认证（Federated Credentials），用于：

- `az login` — Azure CLI 登录（OIDC，无需密码）
- `az aks get-credentials` — 获取 AKS 集群凭证
- `kubectl apply` — 部署 K8s 资源

但 **OIDC 不能用于 ACR docker push**。Azure Container Registry 的 token exchange 不支持 OIDC federated token，所以推送镜像需要 SP client secret。

### 首次配置 ACR 推送凭证

在 `merlin deploy shared-resource --execute` 创建完 SP 后，运行：

```bash
# 交互模式（会提示选择 ring）
./scripts/setup-github-acr-secrets.sh

# 非交互模式
./scripts/setup-github-acr-secrets.sh --ring test
./scripts/setup-github-acr-secrets.sh --ring staging

# 指定目标 repo（默认: trinity + alluneed）
./scripts/setup-github-acr-secrets.sh --ring test --repos TheDeltaLab/trinity
```

脚本会自动：
1. 查找对应 ring 的 SP（`brainly-github-tst` 或 `brainly-github-stg`）
2. 创建 client secret（有效期 2 年）
3. 将凭证写入 GitHub repo 的 Secrets / Variables

### GitHub 配置项说明

脚本写入的配置（AKS 专用，不影响 ACA）：

| 类型 | 名称 | 用途 |
|------|------|------|
| Secret | `AKS_AZURE_CLIENT_ID` | SP appId（OIDC 登录 Azure CLI） |
| Secret | `AKS_ACR_USERNAME` | SP appId（docker login 用户名） |
| Secret | `AKS_ACR_PASSWORD` | SP client secret（docker login 密码） |
| Variable | `AKS_ACR_NAME` | ACR 名称（如 `brainlysharedacr`） |

已有的配置（OIDC + ACA 相关）：

| 类型 | 名称 | 用途 |
|------|------|------|
| Secret | `AZURE_CLIENT_ID_NIGHTLY` | SP appId（OIDC 联合认证） |
| Secret | `AZURE_TENANT_ID` | Azure AD 租户 ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | Azure 订阅 ID |
| Variable (org) | `NIGHTLY_REGISTRY_NAME` | ACA 的 nightly ACR 名称 |

> **注意**：AKS 和 ACA 使用不同的 ACR 和认证方式，配置名称有意区分以避免冲突。

### Secret 过期轮换

SP client secret 默认 2 年有效。过期后重新运行脚本即可轮换：

```bash
./scripts/setup-github-acr-secrets.sh --ring test
./scripts/setup-github-acr-secrets.sh --ring staging
```

脚本会创建新 secret 并自动更新 GitHub Secrets，旧 secret 自动失效。

---

## AKS 部署模式：CI/CD vs 手动

AKS 项目的部署分为两个层面，由不同的执行者操作：

### 层面总览

| 层面 | 资源类型 | 执行者 | 频率 | 命令 |
|------|----------|--------|------|------|
| **Azure 基础设施** | AzureServicePrincipal, AzureKeyVault, AzureDnsZone 等 | 开发者本地 | 首次 + 变更时 | `merlin deploy` |
| **K8s 工作负载** | KubernetesDeployment, Service, Ingress, ConfigMap 等 | GitHub Actions (CI/CD) | 每次代码推送 | `merlin deploy --k8s-only` |

### 1. Azure 基础设施（手动操作）

以下资源需要 Azure AD / ARM 权限，**必须由开发者本地执行**（不在 CI/CD 中运行）：

```bash
# 前提：本地已登录 Azure
az login
az account set --subscription <subscription-id>

# ① 部署共享基础设施（AKS 集群、ACR、Key Vault 等）— 通常只需一次
merlin deploy shared-resource --execute --ring test --region koreacentral
merlin deploy shared-k8s-resource --execute --ring test --region koreacentral

# ② 部署项目的 Azure 资源（如 AzureServicePrincipal.admin-aad）
cd /path/to/trinity
merlin deploy ./merlin-resources --execute --ring test --region koreacentral

# ③ 配置 GitHub Actions 凭证
cd /path/to/merlin
./scripts/setup-github-acr-secrets.sh --ring test
```

**需要手动操作的场景：**

| 场景 | 操作 |
|------|------|
| 首次部署新项目 | 运行步骤 ①②③ |
| 修改了 `adminaad.yml`（redirect URI、权限等） | 重新运行步骤 ② |
| 修改了 `shared-resource/` | 重新运行步骤 ① |
| SP client secret 过期（2 年） | 重新运行步骤 ③ |
| 添加新 ring/region | 重新运行步骤 ①②③ |

> **提示**：步骤 ② 会同时部署 K8s 资源和 Azure 资源。如果只想部署 Azure 资源（跳过 K8s），目前需要手动运行完整部署。K8s 资源的 `kubectl apply` 是幂等的，重复执行无害。

### 2. K8s 工作负载（CI/CD 自动化）

GitHub Actions 使用 `--k8s-only --no-shared` 标志，只部署 Kubernetes 类型的资源：

```yaml
# .github/workflows/aks-deploy.yml 关键步骤
merlin deploy ./merlin-resources \
  --k8s-only \
  --no-shared \
  --execute \
  --ring test \
  --region koreacentral
```

**标志说明：**

| 标志 | 作用 |
|------|------|
| `--k8s-only` | 只部署 `Kubernetes*` 类型的资源，跳过 Azure/GitHub 类型 |
| `--no-shared` | 不部署共享资源（ACR、AKS 集群等），但仍编译它们以解析 `${ }` 表达式 |

**CI/CD 的 SP 权限要求（最小权限）：**

| 角色 | 范围 | 用途 |
|------|------|------|
| AKS Cluster User Role | `shared-rg-{ring}-{region}` | `az aks get-credentials` |
| AKS RBAC Writer | `shared-rg-{ring}-{region}` | `kubectl apply`（创建/更新 K8s 资源） |
| AcrPush | 共享 ACR | docker push |
| Reader | 共享 ACR | `az acr login` 资源发现 |

> **注意**：CI/CD 的 SP **不需要** `Microsoft.Resources/subscriptions/resourcegroups/write` 或 Azure AD Graph 权限。`--k8s-only` 确保不会触发这些操作。

### 3. 部署顺序（新项目首次上线）

```
1. merlin deploy shared-resource --execute          # 共享 Azure 基础设施
2. merlin deploy shared-k8s-resource --execute      # AKS 集群 + NGINX + cert-manager
3. merlin deploy ./merlin-resources --execute       # 项目 Azure 资源 + K8s 工作负载
4. ./scripts/setup-github-acr-secrets.sh            # 配置 CI/CD 凭证
5. 之后 CI/CD 自动处理 K8s 部署（--k8s-only --no-shared）
```

---

## 常见问题和排错

### Q: 新项目部署时 Pod 卡在 ContainerCreating / FailedMount

**症状**：`MountVolume.SetUp failed ... No matching federated identity record found for presented assertion subject 'system:serviceaccount:<namespace>:<sa-name>'`

**原因**：共享的 `kv-workload` SP 没有新项目 ServiceAccount 的 federated credential。

**修复**：在 `shared-k8s-resource/sharedkvsp.yml` 的 `federatedCredentials` 中添加新项目的 SA：

```yaml
# shared-k8s-resource/sharedkvsp.yml
specificConfig:
  - ring: test
    federatedCredentials:
      # ... 已有项目 ...
      # 新项目 namespace ServiceAccount
      - name: myapp-sa
        issuer: ${ KubernetesCluster.aks.oidcIssuerUrl }
        subject: system:serviceaccount:myapp:myapp-workload-sa
```

然后运行 `merlin deploy shared-k8s-resource --execute --ring test --region koreacentral`。

### Q: CI/CD 的 `az login` 报 AADSTS700213 (No matching federated identity record)

**症状**：`No matching federated identity record found for presented assertion subject 'repo:TheDeltaLab/myapp:environment:nightly'`

**原因**：共享 GitHub SP 没有新项目 repo 的 federated credential。

**修复**：在 `shared-resource/sharedgithubsp.yml` 的 `federatedCredentials` 中添加新项目 repo：

```yaml
# shared-resource/sharedgithubsp.yml
specificConfig:
  - ring: test
    federatedCredentials:
      # ... 已有项目 ...
      - name: myapp-github-nightly
        subject: repo:TheDeltaLab/myapp:environment:nightly
```

然后运行 `merlin deploy shared-resource --execute --ring test --region koreacentral`。

### Q: SecretProviderClass 创建在了 default namespace

**症状**：`kubectl get secretproviderclass -n myapp` 找不到，但 `-n default` 能找到。

**原因**：`KubernetesManifest` 的 manifest YAML 中 metadata 缺少 `namespace` 字段。merlin 的 `namespace` config 只影响 `kubectl create namespace`，不影响 manifest 内容本身。

> **注意**：`merlin init` 生成的模板已包含 `namespace` 字段。如果你手动创建了 SecretProviderClass manifest，请确保 metadata 中有 namespace。

**修复**：在 manifest 的 metadata 中显式指定 namespace：

```yaml
defaultConfig:
  namespace: myapp
  manifest: |
    apiVersion: secrets-store.csi.x-k8s.io/v1
    kind: SecretProviderClass
    metadata:
      name: myapp-secret-provider
      namespace: myapp            # ← 必须显式指定
    spec:
      ...
```

---

### 新项目接入共享资源清单

当一个新项目要接入 Merlin 管理的共享 AKS 集群时，除了在项目 repo 中创建 `merlin-resources/` 外，还需要在 **merlin 仓库**中更新以下共享资源配置：

| # | 文件 | 要添加的内容 | 用途 |
|---|------|-------------|------|
| 1 | `shared-k8s-resource/sharedkvsp.yml` | 新项目的 `federatedCredentials` 条目（每个 ring 都要加） | 让新项目的 K8s ServiceAccount 能通过 Workload Identity 访问 Key Vault |
| 2 | `shared-resource/sharedgithubsp.yml` | 新项目 repo 的 `federatedCredentials` 条目（每个 ring 都要加） | 让 GitHub Actions OIDC 登录 Azure |

更新后需要依次部署：

```bash
# 1. 部署共享资源（更新 GitHub SP 的 federated credentials）
merlin deploy shared-resource --execute --ring test --region koreacentral

# 2. 部署共享 K8s 资源（更新 kv-workload SP 的 federated credentials）
merlin deploy shared-k8s-resource --execute --ring test --region koreacentral
```

此外，新项目的 GitHub repo 需要配置以下 Secrets / Variables：

| 类型 | 名称 | 值 | 来源 |
|------|------|-----|------|
| Secret | `AKS_AZURE_CLIENT_ID` | GitHub SP 的 appId | `az ad sp list --filter "displayName eq 'brainly-github-tst'"` |
| Secret | `AZURE_TENANT_ID` | Azure AD 租户 ID | `az account show --query tenantId` |
| Secret | `AZURE_SUBSCRIPTION_ID` | Azure 订阅 ID | `az account show --query id` |
| Secret | `AKS_ACR_USERNAME` | GitHub SP 的 appId | 同 `AKS_AZURE_CLIENT_ID` |
| Secret | `AKS_ACR_PASSWORD` | GitHub SP 的 client secret | `az ad app credential reset --id <appId> --append --display-name "github-actions-acr-<project>"` |
| Variable | `AKS_ACR_NAME` | 共享 ACR 名称 | `brainlysharedacr` |

> **注意**：`az ad app credential reset --append` 创建新 secret 不影响现有 secret。secret 的值只在创建时显示一次，之后无法再查看。

---

### Q: `merlin deploy` 报 "path not found"

确保在项目根目录下运行，且 `merlin-resources/` 目录存在：

```bash
ls merlin-resources/merlin.yml   # 应该存在
merlin deploy                    # 默认找 ./merlin-resources
```

### Q: 编译缓存导致改动不生效

Merlin 会缓存编译结果。如果修改了 merlin 本身的代码，用 `--no-cache` 强制重编译：

```bash
merlin deploy --no-cache
```

或删除缓存文件：

```bash
rm -rf .merlin .merlin-cache
```

### Q: `merlin` 命令输出的版本不对

可能有旧版 `merlin` npm 包冲突。检查并清理：

```bash
merlin --version                    # 确认当前版本
which merlin                        # 查看 merlin 指向哪里
pnpm list -g --depth 0 | grep -i merlin  # 检查全局包
```

如果发现旧包，先移除再重新 link：

```bash
pnpm remove -g merlin              # 移除旧包
cd /path/to/merlin && pnpm link:global   # 重新 link
```

### Q: dry-run 正常但 `--execute` 报错

1. 确保已登录云服务：`az login && az account show`
2. 确保 K8s 工具已安装：`merlin prerequisites`
3. 检查 AKS 凭据：`kubectl cluster-info`

### Q: `${ }` 表达式无法解析

1. 确保被引用的资源在 `dependencies` 中声明
2. 确保引用格式正确：`${ Type.name.exportKey }`
3. `${ this.ring }` 和 `${ this.region }` 不需要声明依赖

### Q: specificConfig 覆盖没生效

1. 检查 ring/region 拼写是否与 `merlin.yml` 中一致
2. 记住**数组是完全替换**不是合并 — 需要写完整内容
3. 多个匹配条目按声明顺序依次应用

### Q: `--also` 是什么意思

`--also` 用于在部署时包含额外的资源目录。典型场景：你的应用依赖共享资源（Key Vault、ACR 等），但它们在另一个目录里：

```bash
# 部署应用时同时包含共享基础设施
merlin deploy ./merlin-resources --also shared-resource --also shared-k8s-resource --execute
```

### Q: 如何查看当前部署的资源状态

```bash
merlin list --ring staging --region koreacentral
# 输出每个资源的实际云端状态

merlin list --no-status    # 快速模式，不查询云端
merlin list --json         # JSON 输出，适合脚本处理
```

### Q: 部署了 OAuth2 但用户登录报 AADSTS50105

这是因为 `appRoleAssignmentRequired=true` 生效了，但还没分配用户。去 Azure Portal：

Enterprise applications → 你的应用 → Users and groups → **Add user/group**

### Q: 部署了 OAuth2 但 API permissions 显示 "Not granted"

说明 admin consent 没成功。让租户管理员操作：

```bash
az ad app permission admin-consent --id <appId>
```

或在 Azure Portal → App registrations → API permissions → "Grant admin consent"。

### Q: OAuth2 Proxy 报 "invalid_client" 错误

通常是 client secret 问题：
1. 检查 Key Vault 中是否有对应的 secret：`az keyvault secret show --vault-name <vault> --name <secret-name>`
2. 如果是重新部署（非首次），secret 不会自动重新生成。可能需要手动轮换（见"模式 2"中的轮换步骤）
3. 确认 OAuth2 Proxy Pod 重启过以加载最新 secret
