# 常见问题和排错

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md) | [遗留资源](legacy-resources.md)

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

此外，新项目的 GitHub repo 需要配置 Secrets / Variables（详见上方"GitHub Repo Secrets / Variables 配置"表格），并复制 `aks-deploy.yml` workflow（详见"新项目配置 CI/CD Workflow"）。

> **注意**：`az ad app credential reset --append` 创建新 secret 不影响现有 secret。secret 的值只在创建时显示一次，之后无法再查看。

> **首次部署提示**：如果这是整个集群的首次搭建（而非在已有集群中新增项目），还需要让 Global Admin 执行一次 `./scripts/setup-github-sp-permissions.sh` 来配置 SP 的 Graph API 权限和 Azure AD 目录角色。详见上方"首次权限配置"章节。

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

### Q: OAuth2 认证后返回 500 "Oops! Something went wrong"

**症状**：Azure AD 登录成功，回调 `/oauth2/callback` 时返回 500。日志中有 `neither the id_token nor the profileURL set an email`。

**原因**：Azure AD 的 id_token 默认不包含 `email` claim，而 oauth2-proxy 默认用 email 标识用户。

**修复**：在 oauth2-proxy 的 envVars 中添加：

```yaml
- OAUTH2_PROXY_OIDC_EMAIL_CLAIM=preferred_username
```

> `merlin init --with-auth` 生成的模板已包含此配置。如果是手动创建的 oauth2-proxy 配置，需要手动添加。
