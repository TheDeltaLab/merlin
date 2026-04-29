# 历史遗留资源（test 环境）

> **文档导航**：[快速开始](getting-started.md) | [KubernetesApp 参考](kubernetes-app-reference.md) | [CI/CD 指南](cicd-guide.md) | [CLI 参考](cli-reference.md) | [排错指南](troubleshooting.md) | [遗留资源](legacy-resources.md)

## 背景

`test` 环境的 Postgres 和 Blob Storage 在 Merlin 接管之前就已经存在，并且承载了不少历史业务数据（用户、对话、录音、转写结果等）。如果切到 Merlin 在 `shared-resource/sharedpsql.yml` / `sharedabs.yml` 中定义的全新账号（`brainlysharedtstkrcpsql` / `brainlysharedtstkrcabs`），需要做一次完整的数据迁移 —— 在没有切到 staging / production 之前，迁移的收益不抵风险。

因此**当前 `test` 环境复用以下两份历史资源**：

| 资源类型 | 历史名称 | Resource Group | Region | 说明 |
|---|---|---|---|---|
| Azure Postgres Flexible Server | `delta-shared-test-krc-pg` | `delta-shared-test-krc-rg` | koreacentral | trinity / synapse 等服务的主数据库（`Standard_B1ms` Burstable） |
| Azure Blob Storage Account | `brainlydevblobstorage` | `Storage-Dev-RG` | koreacentral | 录音、附件、用户上传文件 |

两者都在 subscription `11fc5efa-7f79-4c83-b6d9-dbe109e00987` 下。`sharedkvsp.yml` 的 test ring `Storage Blob Data Contributor` scope 已经切到 `Storage-Dev-RG/brainlydevblobstorage`。

## 部署影响

### `test` ring

- `shared-resource/sharedpsql.yml` 和 `sharedabs.yml` 的 `ring` 字段已经**只剩 `staging`**，所以 `merlin deploy shared-resource --execute --ring test` 不会再尝试创建这两个资源 —— 无需 `--exclude` 标志。
- 应用侧（trinity / synapse / alluneed / babbage / lovelace / cortex 等）通过 K8s ConfigMap / Key Vault secret 直接连到上述历史资源，连接串不指向 Merlin 命名规则下本应生成的 `brainlysharedtstkrc{psql,abs}`。
- `sharedkvsp.yml` 中 K8s workload SP 的 test ring `Storage Blob Data Contributor` scope 已写死为 `Storage-Dev-RG/brainlydevblobstorage`（不再 scope 到 Merlin 自动生成的命名）。
- `sharedkvsp.yml` 的 `dependencies` 也去掉了 `AzureBlobStorage.shared`（该资源在 test ring 不再存在，依赖只用于编译期 `${ }` 表达式解析，本文件 roleAssignments scope 都是写死的 ARM ID，无需该依赖）。

### `staging` 与 `production` ring

- 没有历史包袱，**应当**走 Merlin 新配置：
  - Postgres：`merlin deploy shared-resource --execute --ring staging --region koreacentral` 会创建 `brainlysharedstgkrcpsql`。
  - Blob Storage：同命令会创建 `brainlysharedstgkrcabs`。
- 应用侧 ConfigMap / Key Vault secret 在 `staging` / `production` 用 Merlin 新建的资源名，无需指向历史账号。
- `sharedkvsp.yml` 的 `staging` specificConfig 里的 `Storage Blob Data Contributor` scope 已经指向 Merlin 新账号（`brainlysharedstgkrcabs` / `brainlysharedstgeasabs`），无需调整。

## 何时迁移 `test` 到 Merlin 新账号

满足以下条件再考虑废弃 `delta-shared-test-krc-pg` / `brainlydevblobstorage`：

1. `staging` 环境跑通且使用率稳定，验证新账号的 SKU、网络规则、备份策略等配置可用。
2. 安排一次完整的数据迁移：
   - Postgres：`pg_dump` → `pg_restore` 到 `brainlysharedtstkrcpsql`，期间应用切只读或停机。
   - Blob Storage：`azcopy sync` 把所有 container 复制到 `brainlysharedtstkrcabs`，处理 SAS token / immutability policy。
3. 同步更新 trinity 等项目的 `merlin-resources/` 中相关 ConfigMap / Key Vault secret 引用，并把 `sharedkvsp.yml` 的 test ring scope 切到 `brainlysharedtstkrcabs`。
4. 验证 `test` 应用读写新账号正常后，把历史资源从 portal 上 freeze（暂时改 access tier / 设只读），灰度一段时间再删除。

## 维护规则

- **不要往 `shared-resource/sharedpsql.yml` 或 `sharedabs.yml` 里加 test 专属的 `specificConfig` 来"模拟"历史资源**。这会污染配置 SSoT，并且 Merlin 命名规则不允许直接产生 `brainlydevblobstorage` 这样的名字。
- 添加新项目时，如果项目的 K8s workload 需要访问历史 ABS / Postgres，记得在 `sharedkvsp.yml` 的 `test` specificConfig 中加上对应的 role assignment（scope 指向历史资源 ARM ID），不要假设新项目自动继承访问权限。
- 在 `staging` / `production` 上线前，请先 review 一次 trinity / synapse / 各项目的 `merlin-resources/` 中所有连接串相关 ConfigMap / secret，确认它们读取的环境变量在 `test` 和 `staging` 之间能切换到不同的账号（推荐做法：通过 `${ this.ring }`-based `specificConfig` 区分）。
