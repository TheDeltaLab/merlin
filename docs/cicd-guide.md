# GitHub Actions CI/CD 配置

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md)

### 概述

Merlin 创建的 `AzureServicePrincipal`（在 `shared-resource/sharedgithubsp.yml` 中定义）为 GitHub Actions 提供了 OIDC 联合认证（Federated Credentials），支持完整 CI/CD 部署：

- `az login` — Azure CLI 登录（OIDC，无需密码）
- `az aks get-credentials` — 获取 AKS 集群凭证
- `kubectl apply` — 部署 K8s 资源
- `az ad app create/update` — 创建/更新 Azure AD App Registration
- `az role assignment create` — 创建角色分配
- `az keyvault secret set` — 管理 Key Vault secrets
- 以及所有 `merlin deploy --execute` 需要的 Azure ARM 操作

但 **OIDC 不能用于 ACR docker push**。Azure Container Registry 的 token exchange 不支持 OIDC federated token，所以推送镜像需要 SP client secret。

### 首次权限配置（需 Global Admin）

SP 的 ARM 角色由 `merlin deploy shared-resource` 自动分配，但 **MS Graph API 权限**和 **Azure AD 目录角色**需要 Global Administrator 或 Privileged Role Administrator 手动执行一次：

```bash
# 分配所有权限（两个 ring: test + staging）
./scripts/setup-github-sp-permissions.sh

# 只配置某个 ring
./scripts/setup-github-sp-permissions.sh test
./scripts/setup-github-sp-permissions.sh staging
```

脚本会自动完成以下操作（幂等，可重复运行）：

1. **MS Graph API 权限** — 声明 `Application.ReadWrite.All`、`AppRoleAssignment.ReadWrite.All`、`Directory.Read.All`
2. **Admin consent** — 授权 Graph API 权限
3. **ARM RBAC 角色** — 在订阅级别分配 6 个角色（Contributor、User Access Administrator、AcrPush、AKS Cluster User、AKS RBAC Writer、Key Vault Secrets Officer）
4. **Azure AD 目录角色** — 分配 Directory Readers 和 Application Administrator

> ⚠️ 此脚本必须用有 **Owner（订阅）** + **Global Admin（租户）** 权限的账号执行。普通开发者账号会导致部分角色分配静默失败（脚本用 `|| true` 保证幂等性，但错误也会被吞掉）。

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

# ①b 首次：让 Global Admin 执行权限配置脚本（只需一次）
./scripts/setup-github-sp-permissions.sh

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
| 首次部署新项目 | 运行步骤 ①②③（首次还需 ①b） |
| 修改了 `adminaad.yml`（redirect URI、权限等） | 重新运行步骤 ② |
| 修改了 `shared-resource/` | 重新运行步骤 ① |
| SP client secret 过期（2 年） | 重新运行步骤 ③ |
| 添加新 ring/region | 重新运行步骤 ①②③ |

> **提示**：步骤 ② 会同时部署 K8s 资源和 Azure 资源。如果只想部署 Azure 资源（跳过 K8s），目前需要手动运行完整部署。K8s 资源的 `kubectl apply` 是幂等的，重复执行无害。

### 2. K8s 工作负载（CI/CD 自动化）

GitHub Actions 使用 `--no-shared` 标志部署 Kubernetes 资源：

```yaml
# .github/workflows/aks-deploy.yml 关键步骤
merlin deploy ./merlin-resources \
  --no-shared \
  --execute \
  --ring test \
  --region koreacentral
```

**标志说明：**

| 标志 | 作用 |
|------|------|
| `--no-shared` | 不部署共享资源（ACR、AKS 集群等），但仍编译它们以解析 `${ }` 表达式 |
| `--k8s-only` | （可选）只部署 `Kubernetes*` 类型的资源，跳过 Azure/GitHub 类型 |

#### CI/CD Workflow 完整说明（`.github/workflows/aks-deploy.yml`）

每个项目的 `aks-deploy.yml` 是统一的 AKS 部署流水线，包含 3 个可选步骤：

```
Step 1: Deploy merlin resources  (ConfigMap, Ingress, Secret 等 K8s 资源)
Step 2: Build Docker image       (构建并推送到共享 ACR)
Step 3: Update K8s Deployment    (更新镜像标签，触发滚动更新)
```

**触发方式：**

| 触发 | 行为 |
|------|------|
| `push` to `main` | 自动检测变更的 app，执行 Step 2 + 3（**不**自动部署 merlin 资源） |
| `workflow_dispatch` | 手动选择执行哪些步骤、目标 ring/region、要构建的 app |

> **安全设计**：merlin 资源变更（ConfigMap、Ingress 等）**不会**在 push 时自动部署——只能通过手动 `workflow_dispatch` 触发。这防止意外修改 K8s 配置。

**Workflow 结构：**

```yaml
name: AKS Deploy

on:
  push:
    branches: [main]
    paths:
      - 'apps/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
  workflow_dispatch:
    inputs:
      deploy_resources:
        description: 'Deploy merlin resource changes'
        type: boolean
        default: false
      build_images:
        description: 'Build and push Docker images to ACR'
        type: boolean
        default: false
      update_deployments:
        description: 'Update K8s Deployments to pull latest images'
        type: boolean
        default: false
      ring:
        description: 'Target ring'
        type: choice
        options: [test, staging]
      region:
        description: 'Target region'
        type: choice
        options: [koreacentral, eastasia]

permissions:
  id-token: write    # OIDC 联合认证需要
  contents: read
  packages: read

env:
  ACR_NAME: ${{ vars.AKS_ACR_NAME }}
  ACR_LOGIN_SERVER: ${{ vars.AKS_ACR_NAME }}.azurecr.io
```

**4 个 Jobs 说明：**

| Job | 触发条件 | 作用 |
|-----|---------|------|
| `detect-changes` | 总是运行 | push 时自动检测哪些 app 源码变更；dispatch 时使用用户输入 |
| `deploy-resources` | `deploy_resources == true`（仅手动） | 安装 merlin CLI，`az login` OIDC，`az aks get-credentials`，`merlin deploy --no-shared --execute` |
| `build-images` | app 变更或 `build_images == true` | `az acr login`，`docker build & push`，镜像标签 `nightly-<sha>` |
| `update-deployment` | build 成功或 `update_deployments == true` | `kubectl set image` 更新 Deployment 镜像标签，`kubectl rollout status` 等待完成 |

**镜像标签策略：**

```
<acr>.azurecr.io/<project>/<app>:nightly-<sha>   # 唯一标签（每次构建）
<acr>.azurecr.io/<project>/<app>:nightly          # 浮动标签（最新构建）
```

K8s 通过检测镜像标签变化（`nightly-abc1234` → `nightly-def5678`）自动触发滚动更新。

**单 app vs 多 app 项目区别：**

| | 单 app（如 babbage） | 多 app（如 trinity） |
|---|---|---|
| 变更检测 | 只检测 `apps/portal/` | 分别检测每个 `apps/<name>/` |
| 构建 | 单次构建 | matrix 策略并行构建 |
| 更新 | 直接 `kubectl set image` | matrix 策略并行更新每个 Deployment |
| `inputs.apps` | 无此字段 | 可指定 `'all'` 或逗号分隔的 app 名称 |

**多 app 的 app → Deployment 名称映射**（以 trinity 为例）：

```yaml
# 大多数 app 的 Deployment 名称 = trinity-<app>
web → trinity-web
admin → trinity-admin

# 特殊命名
lance → trinity-lance
lance-worker → trinity-lance-worker
```

**deploy-resources Job 关键步骤详解：**

```yaml
# 1. 安装 Merlin CLI（从 GitHub Packages）
- uses: actions/setup-node@v4
  with:
    registry-url: https://npm.pkg.github.com
- run: npm install -g @thedeltalab/merlin
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 2. Azure OIDC 登录（无密码，用 federated credential）
- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AKS_AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

# 3. 获取 AKS 凭证（名称由 ring + region 推导）
- run: |
    az aks get-credentials \
      --name "shared-aks-${RING_SHORT}-${REGION_SHORT}-aks" \
      --resource-group "shared-rg-${RING_SHORT}-${REGION_SHORT}"

# 4. 部署 merlin 资源
- run: |
    merlin deploy ./merlin-resources \
      --no-shared --execute \
      --ring $RING --region $REGION
```

**build-images Job 关键步骤：**

```yaml
# ACR 登录用 SP client secret（OIDC 不支持 ACR token exchange）
- uses: docker/login-action@v3
  with:
    registry: ${{ env.ACR_LOGIN_SERVER }}
    username: ${{ secrets.AKS_ACR_USERNAME }}
    password: ${{ secrets.AKS_ACR_PASSWORD }}

# Docker Buildx + registry cache（加速重复构建）
- uses: docker/build-push-action@v6
  with:
    context: .
    file: apps/${{ matrix.app }}/Dockerfile
    push: true
    tags: ${{ steps.docker-meta.outputs.tags }}
    cache-from: type=registry,ref=<acr>/<project>/<app>:buildcache
    cache-to: type=registry,ref=<acr>/<project>/<app>:buildcache,mode=max
```

**update-deployment Job 关键步骤：**

```yaml
# 获取当前 container 名（不一定和 app 名一致）
CONTAINER=$(kubectl get deployment/$DEPLOYMENT -n $NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].name}')

# 更新镜像标签触发滚动更新
kubectl set image deployment/$DEPLOYMENT \
  $CONTAINER=$IMAGE_URI -n $NAMESPACE

# 等待 rollout 完成（超时 5 分钟）
kubectl rollout status deployment/$DEPLOYMENT \
  -n $NAMESPACE --timeout=300s
```

#### 新项目配置 CI/CD Workflow

在新项目中创建 `.github/workflows/aks-deploy.yml` 时，需要修改的关键部分：

1. **`paths` 触发路径** — 根据项目的目录结构调整

2. **app 列表** — 修改 `DOCKER_APPS` 数组和 matrix 配置

3. **镜像路径** — `<acr>/<project>/<app>` 中的 `<project>` 部分

4. **Deployment 名称映射** — `resolve deployment name` step 中的 case 语句

5. **namespace** — `update-deployment` step 中的 `NAMESPACE` 变量

可以直接复制 [babbage 的 aks-deploy.yml](https://github.com/TheDeltaLab/babbage/blob/main/.github/workflows/aks-deploy.yml)（单 app 模板）或 [trinity 的 aks-deploy.yml](https://github.com/TheDeltaLab/trinity/blob/main/.github/workflows/aks-deploy.yml)（多 app 模板）作为起点。

#### GitHub Repo Secrets / Variables 配置

| 类型 | 名称 | 值 | 用途 |
|------|------|-----|------|
| Secret | `AKS_AZURE_CLIENT_ID` | GitHub SP 的 appId | OIDC `az login` |
| Secret | `AZURE_TENANT_ID` | Azure AD 租户 ID | OIDC `az login` |
| Secret | `AZURE_SUBSCRIPTION_ID` | Azure 订阅 ID | OIDC `az login` |
| Secret | `AKS_ACR_USERNAME` | GitHub SP 的 appId | ACR docker push |
| Secret | `AKS_ACR_PASSWORD` | GitHub SP 的 client secret | ACR docker push |
| Variable | `AKS_ACR_NAME` | `brainlysharedacr` | ACR 名称 |

> **注意**：OIDC 登录使用 `id-token: write` permission + federated credential（无密码）。但 ACR docker push 不支持 OIDC token exchange，必须用 SP client secret。

**CI/CD 的 SP 权限（完整 CI/CD 部署）：**

GitHub SP (`brainly-github-tst` / `brainly-github-stg`) 已配置为支持完整 CI/CD 部署（不限于 K8s），权限定义在 `shared-resource/sharedgithubsp.yml`。

ARM RBAC 角色（订阅级别）：

| 角色 | 用途 |
|------|------|
| Contributor | 创建/更新所有 ARM 资源（RG、ACA、ACR、Storage、KV、Redis、PG 等） |
| User Access Administrator | 创建 role assignment（authProvider、SP roleAssignments） |
| AcrPush | 推送 Docker 镜像（Contributor 不包含 ACR 数据面推送） |
| Azure Kubernetes Service Cluster User Role | `az aks get-credentials` |
| Azure Kubernetes Service RBAC Writer | `kubectl apply`（K8s 数据面写入） |
| Key Vault Secrets Officer | 读写 Key Vault secrets（Contributor 不包含 KV 数据面） |

MS Graph API 权限（需 admin consent）：

| 权限 | 用途 |
|------|------|
| Application.ReadWrite.All | 创建/更新 AD Apps、SPs、federated credentials |
| AppRoleAssignment.ReadWrite.All | 管理 app role assignments（EntraID auth provider） |
| Directory.Read.All | 查询目录数据（`az ad app list` 等） |

Azure AD 目录角色：

| 角色 | 用途 |
|------|------|
| Directory Readers | 读取目录对象（SP、App 查询） |
| Application Administrator | 管理 AD App 注册和 SP |

> **注意**：MS Graph API 权限和 Azure AD 目录角色需要 **Global Administrator** 或 **Privileged Role Administrator** 才能分配。首次设置运行 `./scripts/setup-github-sp-permissions.sh`（见上方"首次权限配置"）。

> **K8s-only 模式**：如果 CI/CD 只用 `--k8s-only` 标志，实际只需要 AKS Cluster User、AKS RBAC Writer 和 Directory.Read.All（用于解析 `${ AzureServicePrincipal.*.clientId }` 表达式）。但订阅级角色不会造成安全风险，因为 `--k8s-only` 会跳过所有非 K8s 操作。

### 3. 部署顺序（新项目首次上线）

```
1. merlin deploy shared-resource --execute          # 共享 Azure 基础设施（创建 SP + federated credentials）
2. ./scripts/setup-github-sp-permissions.sh         # 首次：Global Admin 执行，分配 Graph/Directory 权限
3. merlin deploy shared-k8s-resource --execute      # AKS 集群 + NGINX + cert-manager
4. merlin deploy ./merlin-resources --execute       # 项目 Azure 资源 + K8s 工作负载
5. ./scripts/setup-github-acr-secrets.sh            # 配置 CI/CD ACR 推送凭证
6. 配置 GitHub repo Secrets/Variables（见上方"GitHub Repo Secrets / Variables 配置"表格）
7. 复制 aks-deploy.yml 到项目 .github/workflows/（见上方"新项目配置 CI/CD Workflow"）
8. 之后 CI/CD 自动处理部署（push 触发构建 + 滚动更新）
```

> **步骤 2 只需执行一次**。后续新增项目只需在 `sharedgithubsp.yml` 中添加 federated credential 并重新部署步骤 1，无需重复步骤 2。

> **新增项目必须修改的共享配置文件：**
>
> | 文件 | 修改内容 | 何时需要 |
> |------|---------|---------|
> | `shared-resource/sharedgithubsp.yml` | 添加项目的 GitHub Actions federated credential（nightly + staging） | 所有新项目（CI/CD OIDC 登录 Azure） |
> | `shared-k8s-resource/sharedkvsp.yml` | 添加项目的 K8s ServiceAccount federated credential（test + staging） | 项目使用 Key Vault secrets（通过 CSI SecretProviderClass） |
>
> 修改后需要重新部署：
> ```bash
> merlin deploy shared-resource --execute          # sharedgithubsp.yml 变更
> merlin deploy shared-k8s-resource --execute      # sharedkvsp.yml 变更
> ```
>
> **示例** — 为新项目 `myapp` 添加配置：
>
> ```yaml
> # shared-resource/sharedgithubsp.yml — specificConfig.federatedCredentials 中添加：
> - name: myapp-github-nightly
>   subject: repo:TheDeltaLab/myapp:environment:nightly
>
> # shared-k8s-resource/sharedkvsp.yml — specificConfig.federatedCredentials 中添加：
> - name: myapp-sa
>   issuer: ${ KubernetesCluster.aks.oidcIssuerUrl }
>   subject: system:serviceaccount:myapp:myapp-workload-sa
> ```
