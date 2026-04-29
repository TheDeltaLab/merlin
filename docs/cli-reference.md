# Merlin CLI 完整参考

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md) | [遗留资源](legacy-resources.md)

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

> 生成文件详解见 [入门指南](getting-started.md#merlin-init-生成文件详解)

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

> CI/CD 中的 deploy 用法见 [CI/CD 指南](cicd-guide.md)

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
