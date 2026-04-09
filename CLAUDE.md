# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Merlin is a declarative Infrastructure as Code (IaC) tool that compiles YAML resource definitions into TypeScript, then executes deployment commands. It follows a compile-time + runtime architecture where YAML files are compiled to TypeScript, which are then executed to generate cloud CLI commands for infrastructure deployment.

Merlin supports multiple cloud providers via the `MERLIN_CLOUD` environment variable (default: `azure`). YAML resources can use cloud-agnostic type names (e.g. `ContainerApp`) or Azure-specific names (e.g. `AzureContainerApp`) — both are fully supported.

## Prerequisites

Merlin deploys infrastructure using cloud CLI tools. The following tools must be installed on your machine (or CI/CD runner) before running `merlin deploy --execute`.

### Required CLI Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `az` (Azure CLI) | Create Azure resources (AKS, ACR, DNS, etc.) | [docs](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) |
| `helm` | Install Kubernetes packages (NGINX Ingress, cert-manager) | [docs](https://helm.sh/docs/intro/install/) |
| `kubectl` | Apply Kubernetes manifests (Deployments, Services, Ingress) | [docs](https://kubernetes.io/docs/tasks/tools/) |

### Quick Install (macOS)

```bash
brew install azure-cli helm kubectl
```

### Check & Auto-install

Merlin has a built-in prerequisites checker:

```bash
# Check which tools are installed
merlin prerequisites

# Check and auto-install missing tools via Homebrew (macOS only)
merlin prerequisites --install
```

### Authentication

```bash
# Azure
az login

# Verify correct subscription is selected
az account show
az account set --subscription <subscription-id>  # if needed
```

### Kubernetes Deployment Flow

```
merlin deploy shared-k8s-resource --execute    # 1. AKS cluster + NGINX + cert-manager
merlin deploy synapse-k8s-resource --execute   # 2. Application workloads
```

For K8s workloads that depend on `shared-resource` (Key Vault, ACR, etc.), use `--also`:
```
merlin deploy synapse-k8s-resource --also shared-resource --also shared-k8s-resource --execute
```

`az aks get-credentials` is called automatically during AKS cluster deployment, which configures `kubectl` and `helm` to point at the new cluster.

## Common Commands

### Building and Testing
```bash
# Install dependencies
pnpm install

# Build the CLI tool
pnpm build

# Link globally for local development
pnpm link:global

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test -- --coverage

# Lint code
pnpm lint

# Lint and fix
pnpm lint:fix

# Run in development mode (without building)
pnpm dev
```

### Using Merlin CLI

```bash
# Compile YAML resources to TypeScript (outputs to .merlin/)
merlin compile [path]

# Compile with custom output directory
merlin compile --output .build

# Validate resources without generating code
merlin compile --validate-only

# Deploy infrastructure (dry-run by default)
merlin deploy

# Actually execute deployment commands
merlin deploy --execute

# Deploy to specific ring and region
merlin deploy --ring production --region eastus

# Deploy targeting a specific cloud provider
merlin deploy --cloud azure   # default
merlin deploy --cloud alibaba # throws "not yet implemented" (Phase 2)

# Save generated commands to a file
merlin deploy --output-file commands.sh

# Validate resource configuration
merlin validate [path]
```

### Running Tests for Specific Modules

Tests are located in `src/**/test/*.test.ts` directories. To run specific test files:

```bash
# Run all tests
pnpm test

# Run tests matching a pattern
pnpm test parser

# Run a specific test file
pnpm test src/compiler/test/parser.test.ts
```

## Architecture

### Two-Phase Execution Model

Merlin uses a **compile-time + runtime** architecture:

1. **Compile-time** (YAML → TypeScript):
   - Parse YAML resource definitions
   - Validate schema and semantics
   - Transform resources (expand ring/region combinations, merge configs)
   - Generate TypeScript code with resource registrations
   - Output to `.merlin/` directory (a self-contained pnpm project)

2. **Runtime** (TypeScript → Commands):
   - Load generated TypeScript resources
   - Resolve dependencies via runtime registry
   - Render resources to deployment commands (Azure CLI or other cloud CLI)
   - Execute or output commands

### Key Directories

- **`src/merlin.ts`**: CLI entry point with Commander.js commands
- **`src/deployer.ts`**: Deployment orchestration — DAG-based topological sort, parallel execution within levels, provider-driven pre-deploy level rendering
- **`src/compiler/`**: Compile-time logic (parser, validator, transformer, generator, cache, project config, Kubernetes app expander)
- **`src/common/`**: Shared types and resource registry
  - **`src/common/cloudTypes.ts`**: Cloud-agnostic resource type name constants
  - **`src/common/constants.ts`**: Package name/version, shared utilities (`toEnvSlug`, `isResourceNotFoundError`, `execAsync`, `MERLIN_YAML_FILE_PLACEHOLDER`)
  - **`src/common/paramResolver.ts`**: Runtime `${ }` expression resolver
  - **`src/common/statusChecker.ts`**: Deployment status checking
- **`src/azure/`**: Azure-specific resource types, renders, and auth providers
  - **`src/azure/propertyGetter.ts`**: Azure PropertyGetter implementations
  - **`src/azure/preDeployProvider.ts`**: Azure pre-deploy provider for resource group creation/deduplication
  - **`src/azure/register.ts`**: Consolidated Azure provider registration (renders, auth, property getters, pre-deploy)
- **`src/kubernetes/`**: Kubernetes resource renders (Deployment, Service, Ingress, ConfigMap, etc.)
- **`src/github/`**: GitHub integration — `GitHubWorkflow` resource type for triggering GitHub Actions workflow_dispatch
- **`src/cli/`**: CLI utilities — interactive confirmation, default values, init command
- **`src/alibaba/`**: Alibaba Cloud placeholder (Phase 2, not yet implemented)
- **`src/runtime.ts`**: Public API for generated code
- **`src/init.ts`**: Thin cloud dispatcher — calls `registerAzureProviders()` or throws for unknown clouds; registers cloud-neutral K8s/GitHub renders
- **`shared-resource/`**: Cross-project shared infrastructure — ACR, Redis, Postgres, ABS, AKV, GitHub SP with full CI/CD deploy permissions (`project: merlin`)
- **`shared-k8s-resource/`**: Shared Kubernetes infrastructure — AKS cluster, NGINX Ingress, cert-manager, Let's Encrypt issuer, KV workload SP
- **`synapse-k8s-resource/`**: Synapse AI gateway K8s workloads — gateway + dashboard (koreacentral only)
- **`scripts/`**: Operational scripts — `setup-github-sp-permissions.sh` (one-time Global Admin setup for SP Graph API/Directory permissions), `setup-github-acr-secrets.sh` (configure GitHub repo ACR push credentials)
- **`.merlin/`**: Generated TypeScript project (output, not in git)

> **Note:** Project-specific resources (Trinity, Alluneed, etc.) have been moved to their respective project repos (e.g. [trinity](https://github.com/TheDeltaLab/trinity), [alluneed](https://github.com/TheDeltaLab/alluneed)). Each project maintains its own `merlin-resources/` directory and installs `@thedeltalab/merlin` as a dependency. Shared resources (`shared-resource/`, `shared-k8s-resource/`) are bundled in the npm package and auto-included during compile/deploy.

### Compiler Pipeline

The compiler follows this pipeline (see `src/common/compiler.ts`):

1. **Cache Check**: Hash all YAML files + Merlin dist files → skip compilation if cache hit (`cache.ts`)
2. **Discovery**: Find all `.yml`/`.yaml` files recursively, auto-include bundled shared resources
3. **Parse**: Parse YAML with syntax error handling (`parser.ts`)
4. **Project Defaults**: Discover `merlin.yml` project configs and apply directory-wide defaults for project/ring/region/authProvider (`projectConfig.ts`)
5. **Validate**: Schema validation with Zod + semantic validation including `${ }` expression checking (`validator.ts`, `schemas.ts`)
6. **Expand Composites**: Expand composite types like `KubernetesApp` into Deployment + Service + Ingress (`kubernetesAppExpander.ts`)
7. **Transform**: Expand ring×region cartesian product, merge `defaultConfig` + `specificConfig`, parse `${ }` expressions into `ParamValue` objects (`transformer.ts`)
8. **Generate**: Generate TypeScript code with resource objects and registrations (`generator.ts`)
9. **Initialize**: Setup `.merlin/` as pnpm project with tsup build config (`initializer.ts`)
10. **Build**: Run `pnpm build` in `.merlin/` to bundle TypeScript
11. **Cache Write**: Write hash to `.merlin-cache` for future cache hits

### Resource Lifecycle

1. **YAML Definition** → Define resource in `resources/*.yml` with `name`, `type`, `ring`, `region`, `authProvider`, `dependencies`, `defaultConfig`, `specificConfig`, `exports`
2. **Compilation** → YAML compiled to TypeScript resource objects (with composite type expansion and cache optimization)
3. **Registration** → Resources auto-register in runtime registry (`registerResource()`)
4. **Deployment** → Deployer builds a DAG via topological sort, groups resources into execution levels, prepends an optional cloud-specific pre-deploy level, then deploys in parallel within each level (`deployer.ts`)

### Registry Pattern

Merlin uses registries (global Maps) for runtime lookup:

- **Resource Registry** (`common/registry.ts`): Maps `name:ring:region` → `Resource`
- **Render Registry** (`common/resource.ts`): Maps `resourceType` → `Render` implementation
- **Auth Provider Registry**: Maps `authProviderName` → `AuthProvider` implementation
- **Property Getter Registry**: Maps `getterName` → `PropertyGetter` implementation

Cloud-specific registrations are consolidated in each provider's `register.ts` (e.g. `src/azure/register.ts`). The `src/init.ts` module is a thin dispatcher that calls the appropriate provider's registration function based on `MERLIN_CLOUD`. All registrations are imported by generated code via `import 'merlin/init.js'`.

### Multi-Cloud Architecture

Merlin supports multiple cloud providers via the `MERLIN_CLOUD` environment variable. `src/init.ts` reads this at startup and registers the appropriate render implementations.

**Cloud-agnostic type constants** (`src/common/cloudTypes.ts`):

| Constant | YAML `type:` value | Azure implementation |
|---|---|---|
| `CONTAINER_APP_TYPE` | `ContainerApp` | `AzureContainerAppRender` |
| `CONTAINER_REGISTRY_TYPE` | `ContainerRegistry` | `AzureContainerRegistryRender` |
| `CONTAINER_APP_ENVIRONMENT_TYPE` | `ContainerAppEnvironment` | `AzureContainerAppEnvironmentRender` |
| `OBJECT_STORAGE_TYPE` | `ObjectStorage` | `AzureBlobStorageRender` |
| `KEY_VALUE_STORE_TYPE` | `KeyValueStore` | Not yet registered (use `AzureRedisEnterprise` directly) |
| `RELATIONAL_DB_TYPE` | `RelationalDatabase` | Not yet registered (use `AzurePostgreSQLFlexible` directly) |
| `SECRET_VAULT_TYPE` | `SecretVault` | Not yet registered (use `AzureKeyVault` directly) |
| `LOG_SINK_TYPE` | `LogSink` | `AzureLogAnalyticsWorkspaceRender` |
| `DNS_ZONE_TYPE` | `DnsZone` | `AzureDnsZoneRender` |
| `SERVICE_PRINCIPAL_TYPE` | `ServicePrincipal` | `AzureServicePrincipalRender` |
| `APP_REGISTRATION_TYPE` | `AppRegistration` | `AzureADAppRender` |
| `KUBERNETES_CLUSTER_TYPE` | `KubernetesCluster` | `AzureAKSRender` |

**Kubernetes type constants** (cloud-agnostic, use kubectl/helm on any cluster):

| Constant | YAML `type:` value |
|---|---|
| `KUBERNETES_NAMESPACE_TYPE` | `KubernetesNamespace` |
| `KUBERNETES_DEPLOYMENT_TYPE` | `KubernetesDeployment` |
| `KUBERNETES_SERVICE_TYPE` | `KubernetesService` |
| `KUBERNETES_INGRESS_TYPE` | `KubernetesIngress` |
| `KUBERNETES_HELM_RELEASE_TYPE` | `KubernetesHelmRelease` |
| `KUBERNETES_MANIFEST_TYPE` | `KubernetesManifest` |
| `KUBERNETES_CONFIG_MAP_TYPE` | `KubernetesConfigMap` |
| `KUBERNETES_SERVICE_ACCOUNT_TYPE` | `KubernetesServiceAccount` |

**Composite type** (compile-time only, expanded before code generation):

| Constant | YAML `type:` value | Expands to |
|---|---|---|
| `KUBERNETES_APP_TYPE` | `KubernetesApp` | `KubernetesDeployment` + `KubernetesService` + `KubernetesIngress` (optional) |

**`init.ts` registration logic**:
```
MERLIN_CLOUD=azure (default)
  → calls registerAzureProviders() from src/azure/register.ts
    ① Cloud-agnostic types (ContainerApp, etc.) → Azure implementations
    ② Azure-specific types (AzureContainerApp, etc.) → same Azure implementations (backwards compat)
    ③ Auth providers (AzureManagedIdentity, AzureEntraID)
    ④ Property getters (13 Azure-specific getters)
    ⑤ Pre-deploy provider (AzurePreDeployProvider)

MERLIN_CLOUD=alibaba → throws Error("Alibaba Cloud provider is not yet implemented")
  → Future: calls registerAlibabaProviders() from src/alibaba/register.ts

MERLIN_CLOUD=<other> → throws Error("Unknown cloud provider")

Cloud-neutral (always registered):
  → GitHub: GitHubWorkflow
  → Kubernetes: Namespace, Deployment, Service, Ingress, HelmRelease, Manifest, ConfigMap, ServiceAccount
```

**Supported regions** (`src/common/resource.ts` — derived from `REGION_SHORT_NAME_MAP` as the single source of truth):
- Azure: `eastus`, `westus`, `eastasia`, `koreacentral`, `koreasouth`
- Alibaba Cloud (Phase 2): `cn-hangzhou`, `cn-shanghai`, `cn-beijing`, `ap-southeast-1`

Alibaba Cloud region short names: `hzh`, `sha`, `bej`, `sg1`.

**CLI `--cloud` option**: `merlin deploy --cloud <azure|alibaba>` sets `MERLIN_CLOUD` env variable when invoking the deploy subprocess.

**Phase 2 placeholder**: `src/alibaba/index.ts` documents the planned Alibaba render mapping (SAE, ACR, OSS, Tair, RDS/PolarDB, KMS, SLS, Alidns).

### PropertyGetter Implementations (`src/azure/propertyGetter.ts`)

PropertyGetters produce the Azure CLI command that resolves a resource export at deploy time. Available getters:

| Getter name | Returns |
|-------------|---------|
| `AzureResourceManagedIdentity` | Object ID of the resource's managed identity |
| `AzureResourceName` | The Azure resource name (via `getResourceName()`) |
| `AzureContainerRegistryServer` | ACR login server URL (e.g. `myacr.azurecr.io`) |
| `AzureContainerAppFqdn` | Container App default ingress FQDN |
| `AzureLogAnalyticsWorkspaceCustomerId` | LAW customer ID |
| `AzureLogAnalyticsWorkspaceSharedKey` | LAW primary shared key |
| `AzureADAppClientId` | AD App `appId` (client ID), looked up by display name |
| `AzureDnsZoneName` | Full DNS zone name (e.g. `chuang.staging.thebrainly.dev`) |
| `AzureKeyVaultUrl` | Key Vault URI (e.g. `https://myvault.vault.azure.net`) |
| `AzureServicePrincipalClientId` | Service Principal's backing appId |
| `AzureRedisEnterpriseUrl` | Redis Enterprise URL (e.g. `rediss://<hostname>:10000`) |
| `AzureResourceApiScope` | AD App API scope (`api://<name>/.default`) |
| `AzureAKSOidcIssuerUrl` | AKS cluster OIDC issuer URL (for Workload Identity federation) |

**Important — `AzureADAppClientId`**: The AD App's `displayName` config field may contain `${ }` parameter expressions (e.g. `merlintest-alluneed-${ this.ring }`). These are stored as `ParamValue` objects at registration time and must be resolved before use. The getter calls `resolveConfig()` first, then `render.getDisplayName(resolved)` to get the correct string. `getDisplayName()` uses the **full** ring name (`staging`, not `stg`) — do not use `getResourceName()` which uses the short ring form.

### Dependency Resolution

Dependencies are declared in YAML (`dependencies[].resource`). Each dependency can specify:
- `resource`: The resource name to depend on
- `isHardDependency`: Whether this is a hard dependency (must exist first)
- `authProvider`: Override the auth provider for this dependency relationship

At runtime, the deploy script uses `getResource(name, ring, region)` to resolve dependency references.

### Configuration Merging

Resources support `defaultConfig` (base config) and `specificConfig` (overrides per ring/region). The transformer merges these during compilation:

1. Start with `defaultConfig`
2. Apply matching `specificConfig` entries in order (ring/region filters)
3. Later configs override earlier ones (deep merge for objects, replace for primitives/arrays)

Example: `specificConfig[{ring: 'production', cpu: 4}]` overrides `defaultConfig.cpu` only for production ring.

### Azure Resource Naming

Azure resources follow a consistent naming pattern (see `src/azure/render.ts`):

- **Resource Group**: `[${project}-|shared-]-rg-${ring}[-${region}]`
  - Example: `merlintest-rg-staging-eas` or `shared-rg-production`

- **Resource Name**: `[${project}-|shared]-${name}-${ring}[-${region}][-${type}]`
  - Example: `merlintest-chuangabs-staging-eas-azureblobstorage`
  - Some resources don't support hyphens (set `supportConnectorInResourceName: false`)

Regions are abbreviated using `REGION_SHORT_NAME_MAP`: `eastasia` → `eas`, `koreacentral` → `krc`, etc.

## Azure-Specific Features

### DNS Zone NS Delegation (`src/azure/azureDnsZone.ts`)

When a DNS Zone resource has `parentName` set in its config, `renderCreate()` automatically appends 10 additional commands after the zone creation command (11 total):

1. Capture NS server 1–4 from the new zone (`az network dns zone show --query nameServers[0..3]`)
2. Capture the parent zone's resource group (`az network dns zone list`)
3. Create the NS record-set in the parent zone (`az network dns record-set ns create --ttl 3600`)
4. Add all 4 NS records to the record-set (`az network dns record-set ns add-record` × 4)

This wires up the child zone's delegation in the parent zone automatically on first create. On `renderUpdate()` NS delegation is **not** re-emitted (it is a one-time setup).

The relative label for the NS record-set is the `dnsName` field (e.g. `chuang.staging`); the target zone is `parentName` (e.g. `thebrainly.dev`).

### Container App DNS Binding (`src/azure/azureContainerApp.ts`)

When `bindDnsZone: { dnsZone, subDomain }` is set in the ACA config, `renderBindDnsZone()` appends these steps after the container app create/update command:

| Step | Command | Notes |
|------|---------|-------|
| 0a | `az network dns zone list` | Capture DNS Zone RG into `$MERLIN_..._DNS_ZONE_RG` |
| 0b | `az containerapp show --query managedEnvironmentId` | Capture env ARM ID |
| 0c | `bash -c "echo $VAR \| sed 's\|.*/\|\|'"` | Extract env name from ARM ID |
| 1 | `bash -c "az containerapp hostname add ... \|\| true"` | Register hostname (idempotent) |
| 2 | `az containerapp show --query ingress.fqdn` | Capture default FQDN |
| 3 | `az network dns record-set cname set-record` | Create CNAME pointing to default FQDN |
| 4 | `az containerapp show --query customDomainVerificationId` | Capture verification ID |
| 5 | `az network dns record-set txt add-record` (name: `asuid.<subDomain>`) | TXT verification record |
| — | `bash -c "sleep 30"` | Wait for DNS propagation |
| 6 | `bash -c "az containerapp hostname bind --validation-method CNAME \|\| true"` | Bind + request managed cert (idempotent) |

**Azure ordering requirement**: `hostname add` (Step 1) must run before `hostname bind` (Step 6). Azure rejects cert requests for hostnames not yet registered on the container app.

**Idempotency**: Steps 1 and 6 use `bash -c '... || true'` to swallow the "already exists" error on re-runs.

### Kubernetes Ingress DNS Binding (`src/kubernetes/kubernetesIngress.ts`)

When `bindDnsZone: { dnsZone }` is set in the Ingress config, `renderBindDnsZone()` appends DNS record commands after the `kubectl apply` Ingress command:

| Step | Command | Notes |
|------|---------|-------|
| 1 | `kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath=...` | Capture LB external IP into `$MERLIN_..._LB_IP` |
| 2 | `az network dns zone list --query "[?name=='...'].resourceGroup"` | Capture DNS Zone RG into `$MERLIN_..._DNS_ZONE_RG` |
| 3 | `bash -c "az network dns record-set a create ... \|\| true; az ... add-record ..."` | Create A record for each host (idempotent) |

**Host → record name derivation**: For host `web.staging.thebrainly.dev` with dnsZone `thebrainly.dev`, the record name is `web.staging` (host minus `.dnsZone` suffix). Every host in `rules[]` must end with the configured `dnsZone`.

**A records vs CNAME**: K8s LoadBalancer exposes an IP (not a FQDN like ACA), so A records are used instead of CNAME.

**Optional config fields**: `ingressServiceName` (default: `ingress-nginx-controller`) and `ingressNamespace` (default: `ingress-nginx`) can override the Ingress controller service lookup.

### Global Resources (`isGlobalResource`)

Some Azure resources are tenant-scoped and have no region (e.g. `AzureADApp`). Setting `isGlobalResource = true` on the Render implementation allows region-aware resources to resolve them by ring only, ignoring region. The registry lookup falls back to ring-only match when an exact ring+region match is not found for a global resource.

### AzureServicePrincipal (`src/azure/azureServicePrincipal.ts`)

`AzureServicePrincipalRender` is a global resource (`isGlobalResource: true`) that manages:
1. **AD App creation** (`az ad app create`)
2. **Service Principal creation** (`az ad sp create --id <appId>`)
3. **Federated Credentials** (OIDC, `az ad app federated-credential create`) — one per entry in `config.federatedCredentials[]`
4. **Role Assignments** (`az role assignment create`) — one per entry in `config.roleAssignments[]`

**`{subscriptionId}` placeholder**: Role assignment scope strings use the literal `{subscriptionId}` (not `${ subscriptionId }`) to avoid Merlin's `${ }` expression parser. At deploy time, `renderRoleAssignments()` captures the real subscription ID via `az account show --query id` and replaces all `{subscriptionId}` occurrences with a shell variable reference.

**Why not `${ this.subscriptionId }`**: Merlin's `parseExpression` would try to evaluate it at compile time and fail since `subscriptionId` is not a valid resource property.

### KubernetesApp Composite Type (`src/compiler/kubernetesAppExpander.ts`)

`KubernetesApp` is a **compile-time composite type** that expands into 2–3 standard Kubernetes resources, reducing YAML boilerplate for typical web service deployments:

1. **KubernetesDeployment** (always) — with containers, probes, resource limits, CSI secret volumes, workload identity, auto-dependency on `KubernetesCluster.aks`
2. **KubernetesService** (always) — ClusterIP service depending on the deployment
3. **KubernetesIngress** (if `ingress` config present) — with TLS, cert-manager, DNS zone binding. Host is auto-generated as `{subdomain}.{ring}.{dnsZone}` by default, or can be overridden with the `host` field for custom patterns like `{ring}.{subdomain}.{dnsZone}`.

Override hooks (`deploymentOverrides`, `serviceOverrides`, `ingressOverrides`) allow fine-grained customization of each generated resource. The expansion happens after validation but before ring×region transformation.

### GitHubWorkflow Resource (`src/github/githubWorkflow.ts`)

`GitHubWorkflow` is a cloud-neutral resource type that triggers GitHub Actions `workflow_dispatch` events during deployment via the `gh` CLI:

- **`repo`**: GitHub repository in `owner/repo` format
- **`workflow`**: Workflow file name or ID (e.g. `docker.yml`)
- **`ref`**: Branch to trigger on (default: `main`)
- **`inputs`**: Key-value pairs passed as workflow inputs
- **`wait`**: Whether to wait for the workflow run to complete before continuing

Registered in `src/init.ts` outside the cloud-specific block (works with any cloud provider).

## Adding New Resource Types

To add support for a new Azure resource type:

1. **Define the resource type constant** in `src/azure/[resourceType].ts`:
   ```typescript
   export const AZURE_NEW_RESOURCE_TYPE = 'AzureNewResource';
   ```

2. **Create a Render implementation** by extending `AzureResourceRender`:
   ```typescript
   export class AzureNewResourceRender extends AzureResourceRender {
     supportConnectorInResourceName = true; // or false

     async renderImpl(resource: Resource): Promise<Command[]> {
       // Return array of Command objects with Azure CLI commands
     }
   }
   ```

3. **Register the render** in `src/azure/register.ts` (inside `registerAzureProviders()`):
   ```typescript
   import { AZURE_NEW_RESOURCE_TYPE, AzureNewResourceRender } from './azureNewResource.js';
   registerRender(AZURE_NEW_RESOURCE_TYPE, new AzureNewResourceRender());
   ```

4. **Create YAML definitions** in `resources/` using the new `type` field

5. **Write tests** in `src/azure/test/` or similar location

### Adding a New Cloud Provider

1. Create `src/<cloud>/register.ts` exporting `register<Cloud>Providers()` that calls `registerRender`, `registerAuthProvider`, `registerPropertyGetter`, and `registerPreDeployProvider`
2. Add an `else if` branch in `src/init.ts` to call the registration function
3. Add the cloud's regions to `REGION_SHORT_NAME_MAP` in `src/common/resource.ts` (types, Zod schemas, and validator hints update automatically)

## YAML Resource Schema

Key fields in resource YAML files:

- **`name`** (required): Resource identifier, unique per ring+region
- **`type`** (required): Resource type (e.g., `AzureBlobStorage`, `AzureContainerApp`)
- **`project`** (optional): Project name (omit for shared resources)
- **`ring`** (required): Single value or array - `test`, `staging`, `production`
- **`region`** (optional): Single value or array - Azure: `eastus`, `westus`, `eastasia`, `koreacentral`, `koreasouth`; Alibaba: `cn-hangzhou`, `cn-shanghai`, `cn-beijing`, `ap-southeast-1`
- **`parent`** (optional): Parent resource name (e.g., container apps need container environment)
- **`authProvider`** (required): Auth provider name or `{name, ...args}`
- **`dependencies`** (required): Array of `{resource, isHardDependency?, authProvider?}`
- **`defaultConfig`** (required): Base configuration object (resource-specific schema)
- **`specificConfig`** (required): Array of config overrides with optional `ring`/`region` filters
- **`exports`** (required): Object mapping export name to property getter (string or `{name, ...args}`)

When `ring` and `region` are arrays, Merlin generates a cartesian product (e.g., 2 rings × 2 regions = 4 resources).

## Testing Conventions

- Test files located in `src/**/test/*.test.ts` subdirectories
- Use Vitest for testing (`import { describe, it, expect } from 'vitest'`)
- Tests run with `globals: true`, so no need to import `describe`/`it`/`expect`
- Coverage excludes test files and merlin.ts entry point
- Test utilities available in `src/test-utils/` (helpers, factories)

## Module System

- **ES Modules** (`"type": "module"` in package.json)
- **Import extensions required**: Use `.js` extensions in imports (TypeScript convention)
- **Path mapping**: Use relative paths, no path aliases configured
- **Runtime exports**: Generated code imports from `merlin/runtime.js`, `merlin/init.js`

## Build Output

- `pnpm build` uses tsup to bundle TypeScript → ESM JavaScript
- Output: `dist/merlin.js` (CLI entry), `dist/runtime.js`, `dist/init.js`
- `dist/merlin.js` has shebang (`#!/usr/bin/env node`) and is executable
- `.merlin/` directory is a separate pnpm project with its own build pipeline

## Git Workflow

Every change must follow this flow: **Issue → Branch → PR → Merge**

1. **Create an Issue** — describe what needs to be done. Assign the issue to yourself and add it to the `Delta` project (`gh issue create --assignee @me --project Delta`)
2. **Create a branch** — `git checkout -b <type>/<short-description>` from main
3. **Commit & push** — use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
4. **Create a PR** — reference the issue with `Closes #<number>` in the body (`gh pr create`)
5. **Assign** — assign the PR to yourself (`gh pr edit --add-assignee @me`)
6. **Merge** — merge the PR on GitHub; release-please will auto-create a release PR based on conventional commits

**IMPORTANT: Every PR must have a corresponding Issue.** Before creating a PR, always create an issue first (if one doesn't already exist). The issue must be:
- Assigned to the person creating the PR (`--assignee @me`)
- Added to the `Delta` project (`--project Delta`)
- Referenced in the PR body with `Closes #<number>`

**After creating the issue**, fill in the Delta project fields using `gh project item-edit`:

| Field | Options | Description |
|-------|---------|-------------|
| **Status** | `Backlog`, `Ready`, `In progress`, `In review`, `Done` | Set to `In progress` when starting work |
| **Priority** | `P0`, `P1`, `P2` | P0 = critical, P1 = important, P2 = nice-to-have |
| **Size** | `XS`, `S`, `M`, `L`, `XL` | Estimated effort |
| **Estimate** | number (hours) | Time estimate in hours |
| **Iteration** | current iteration | Sprint/iteration the work belongs to |

```bash
# Set project fields after issue creation:
# 1. Get the item ID
ITEM_ID=$(gh project item-list 3 --owner TheDeltaLab --format json | jq -r '.items[] | select(.content.number == <ISSUE_NUMBER>) | .id')

# 2. Set fields
gh project item-edit --project-id PVT_kwDODpJN884BODoV --id $ITEM_ID --field-id PVTSSF_lADODpJN884BODoVzg83rtE --single-select-option-id 47fc9ee4   # Status: In progress
gh project item-edit --project-id PVT_kwDODpJN884BODoV --id $ITEM_ID --field-id PVTSSF_lADODpJN884BODoVzg83sNM --single-select-option-id <PRIORITY>  # Priority
gh project item-edit --project-id PVT_kwDODpJN884BODoV --id $ITEM_ID --field-id PVTSSF_lADODpJN884BODoVzg83sNQ --single-select-option-id <SIZE>      # Size
gh project item-edit --project-id PVT_kwDODpJN884BODoV --id $ITEM_ID --field-id PVTF_lADODpJN884BODoVzg83sNU --number <HOURS>                        # Estimate
gh project item-edit --project-id PVT_kwDODpJN884BODoV --id $ITEM_ID --field-id PVTIF_lADODpJN884BODoVzg83sNY --iteration-id <ITERATION_ID>           # Iteration
```

**Field option IDs (for copy-paste):**

Priority: `79628723` (P0), `0a877460` (P1), `da944a9c` (P2)

Size: `911790be` (XS), `b277fb01` (S), `86db8eb3` (M), `853c8207` (L), `2d0801e2` (XL)

Status: `f75ad846` (Backlog), `e18bf179` (Ready), `47fc9ee4` (In progress), `aba860b9` (In review), `98236657` (Done)

**Never commit directly to main.** Direct pushes bypass code review and can trigger unintended release-please releases.

```bash
# Example full workflow
gh issue create --title "feat: add widget support" --body "Description" --assignee @me --project Delta
# Then set project fields (Status, Priority, Size, Estimate, Iteration) as shown above
git checkout -b feat/widget-support
# ... make changes, commit ...
git push -u origin feat/widget-support
gh pr create --title "feat: add widget support" --body "Closes #42" --assignee @me
```

## Important Development Notes

- **Do not commit `.merlin/`** - it's generated output (in `.gitignore`)
- **Import `init.js` before `runtime.js`** - ensures providers are registered before resources load
- **Registry initialization is side-effectful** - `src/init.ts` registers providers on import
- **Ring/Region SSoT** - `RING_SHORT_NAME_MAP` and `REGION_SHORT_NAME_MAP` in `src/common/resource.ts` are the single source of truth. The `Ring`/`Region` TypeScript types, Zod schemas (`schemas.ts`), and validator hint messages are all derived automatically. To add a new ring or region, update only the map.
- **Zod schemas are derived** - `RingSchema` and `RegionSchema` in `schemas.ts` are derived from the short name maps — do NOT hardcode values
- **Deep merge semantics** - objects merge recursively, arrays/primitives replace
- **Resource keys are unique** - `name:ring:region` must be unique across all resources
- **Test isolation** - use `clearRegistry()` in test teardown to reset global state
- **`resolveConfig()` in PropertyGetters** - config fields may be unresolved `ParamValue` objects at getter call time; always call `resolveConfig()` before reading config values that might contain `${ }` expressions
- **`getDisplayName()` vs `getResourceName()`** - for AD Apps (and any resource with a configurable display name), use `getDisplayName()` which returns the full ring name; `getResourceName()` uses the short ring form (`stg`, `tst`) suitable for Azure resource names but not for AD App lookups
- **`bash -c '... || true'` pattern** - use this for idempotent Azure CLI steps that fail with "already exists" on re-runs (e.g. `hostname add`, `hostname bind`)
- **NS delegation is create-only** - `renderNsDelegation()` is called from `renderCreate()` only; if a zone was created outside Merlin, manually run the NS delegation commands against the parent zone
- **After `pnpm build` in merlin root, also rebuild `.merlin/`** - the `.merlin/` project bundles merlin's `dist/init.js` at build time; run `merlin compile` (or `pnpm build` inside `.merlin/`) to pick up merlin source changes
- **`addArrayParams` space-joins values** - Azure CLI expects array parameters as a single space-separated string argument (e.g. `--env-vars "KEY1=VAL1 KEY2=VAL2"`), not multiple positional args. `AzureResourceRender.addArrayParams()` in `render.ts` handles this by calling `.join(' ')`. Do NOT push each element separately.
- **`envVars` is supported on update** - `az containerapp update` does accept `--env-vars`. It is in the shared `ARRAY_PARAM_MAP` (not `CREATE_ONLY_ARRAY_PARAM_MAP`) in `azureContainerApp.ts`.
- **`MERLIN_CLOUD` env variable** - set by `merlin deploy --cloud <provider>`; read in `src/init.ts` to select which render implementations to register. Default: `azure`. Unknown values throw immediately on startup.
- **`execAsync` for resource checks** - All render-phase CLI calls (getDeployedProps, existence checks) use the async `execAsync()` helper from `constants.ts` instead of `execSync`. This keeps the Node event loop non-blocking. The deployer already uses async `execa` for command execution.
- **Provider registration is modular** - Each cloud has its own `register.ts` (e.g. `src/azure/register.ts`) that exports a single `registerProviders()` function. `init.ts` is a thin dispatcher. When adding Alibaba support, create `src/alibaba/register.ts`.
- **Resource group location is explicit** - `AzureResourceGroupRender` no longer falls back to a hardcoded default region. Resource groups must get their location from `resource.region` or `config.location`.
- **`merlin init` scaffolds are intentionally generic** - generated templates use placeholders like `example.com`, `myregistry.azurecr.io`, and `YOUR_AZURE_AD_TENANT_ID`. Replace them before first deploy.

## AKS Cluster Configuration Notes

### NGINX Ingress Health Probe

The Azure Standard LB health probe must use `/healthz` (returns 200) instead of `/` (returns 404). Azure LB HTTP probes only consider 200 as healthy. This is configured via the Helm values annotation:
```yaml
# sharedingressnginx.yml
values:
  controller:
    service:
      annotations:
        service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path: /healthz
```
Without this, the LB marks all backends as unhealthy and external traffic is dropped silently.

### cert-manager + AKS Webhook Conflict

AKS's `admissionsenforcer` takes ownership of cert-manager's validating webhook `namespaceSelector` field, causing Helm upgrade to fail with field manager conflicts. The workaround is to delete the webhook before upgrade:
```yaml
# sharedcertmanager.yml
preCommands:
  - kubectl delete validatingwebhookconfiguration cert-manager-webhook
```

### ConfigMap and manifestToYaml Numeric Strings

K8s ConfigMap `.data` values must be strings. If a YAML value looks like a number (e.g. `PORT: 3000`), `manifestToYaml()` must quote it as `"3000"` or K8s rejects it. The `manifestToYaml()` function in `kubernetesNamespace.ts` handles this with a regex check. `KubernetesConfigMapRender` also applies `String()` coercion on all data values.

### specificConfig Array Replacement

When `specificConfig` overrides an array field (e.g. `containers`), it **completely replaces** the `defaultConfig` array — it does NOT merge. This means staging `specificConfig` for a Deployment must include the **full** container spec (image, ports, probes, volumes, etc.), not just the fields being changed.

### Secrets Flow: Key Vault → Pod

```
Azure Key Vault
  → CSI SecretProviderClass (declares which KV secrets to fetch)
  → K8s Secret (auto-created by CSI driver)
  → Pod env vars (via envFrom secretRef)
```
The CSI driver uses Workload Identity (not client secrets) to authenticate to Key Vault. The `keyvaultName` field in SecretProviderClass must be the vault **name** (not URL), and `tenantId` must be the Azure AD tenant ID (not the SP client ID).

### Container Image Registry

All application images (except Synapse) are stored in the shared ACR (`merlinsharedstgkrcacr.azurecr.io` for staging). Synapse images come from GitHub Container Registry (`ghcr.io/thedeltalab/synapse/`). The AKS cluster has `AcrPull` role on the shared ACR via the `attachAcr` config.

## Current Deployment Status (staging/koreacentral)

### Services

| Namespace | Service | URL | Status |
|-----------|---------|-----|--------|
| trinity | web | https://web.staging.thebrainly.dev | Running |
| trinity | home | https://home.staging.thebrainly.dev | Running |
| trinity | admin | https://admin.staging.thebrainly.dev | Running |
| trinity | worker | (internal only) | Running |
| trinity | lance | (internal only) | CrashLoopBackOff (Redis auth issue — pending fix) |
| trinity | lance-worker | (internal only) | Running |
| synapse | gateway | (internal only) | Running |
| synapse | dashboard | https://synapse.staging.thebrainly.dev | Running |

### Infrastructure

- **AKS Cluster**: `shared-aks-stg-krc-aks` — K8s 1.33, Azure CNI, 3 nodes (auto-scaled from initial 2)
- **LoadBalancer IP**: `20.249.167.216`
- **DNS**: Wildcard `*.staging.thebrainly.dev → 20.249.167.216` in Azure DNS zone `thebrainly.dev` (RG: `Trinity-Dev-RG`)
- **TLS**: Let's Encrypt certificates via cert-manager, all READY

### Known Issues / TODO

- **trinity-lance Redis auth**: `WRONGPASS invalid username-password pair` — Redis Enterprise connection needs correct credentials
- **Admin Easy Auth**: ~~Resolved~~ — oauth2-proxy deployed as OIDC auth layer on nginx ingress. Azure AD App `f33ed582-6f07-4c57-86b5-86cb2f76da8f`, secrets in Key Vault (`oauth2-proxy-client-secret`, `oauth2-proxy-cookie-secret`). Resources in `trinity/merlin-resources/oauth2proxy*.yml`.
- **Centralized logging**: No log aggregation configured yet. Options: Azure Monitor Container Insights (simplest), Grafana + Loki, or EFK stack
