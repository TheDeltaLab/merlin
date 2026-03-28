# Merlin

Declarative Infrastructure as Code (IaC) tool. Define resources in YAML, compile to TypeScript, deploy via cloud CLI (Azure / Alibaba Cloud).

## Overview

Merlin follows a **compile-time + runtime** architecture:

1. **Compile** — YAML resource definitions → TypeScript code (output to `.merlin/`)
2. **Deploy** — TypeScript is executed to render CLI commands for the target cloud, which are then run (or previewed)

## Installation

### As a dependency (for projects using Merlin)

**1. One-time setup: configure GitHub Packages authentication**

Merlin is published to GitHub Packages (`@thedeltalab/merlin`). All developers need to configure npm authentication once:

```bash
# Install GitHub CLI if you haven't
brew install gh

# Login with read:packages scope
gh auth login -s read:packages
# If already logged in, add the scope:
gh auth refresh -h github.com -s read:packages
```

Add to your global `~/.npmrc`:
```ini
//npm.pkg.github.com/:_authToken=${GH_TOKEN}
```

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export GH_TOKEN=$(gh auth token)
```

Restart your terminal or run `source ~/.zshrc`.

**2. Add to your project**

In your project's `.npmrc`:
```ini
@thedeltalab:registry=https://npm.pkg.github.com
```

In your project's `package.json`:
```json
{
  "devDependencies": {
    "@thedeltalab/merlin": "^1.0.0"
  }
}
```

Then `pnpm install` and you're ready to go.

### For Merlin development

```bash
git clone https://github.com/TheDeltaLab/merlin.git
cd merlin
pnpm install
pnpm build
pnpm link:global   # Makes `merlin` command available globally
```

## Usage

```bash
# Compile YAML resources to TypeScript
merlin compile [path]

# Preview deployment commands (dry-run, default)
merlin deploy --input [path]

# Execute the deployment
merlin deploy --input [path] --execute

# Deploy to a specific ring and region
merlin deploy --input [path] --ring staging --region eastasia

# Write commands to a shell script
merlin deploy --input [path] --output-file commands.sh

# Validate resource configuration only
merlin compile [path] --validate-only
```

## Resource Configuration

Resources are defined in YAML files. Example:

```yaml
name: myapp
type: AzureContainerApp
project: myproject
ring:
  - staging
  - production
region:
  - eastasia
  - koreacentral

authProvider:
  name: AzureEntraID

dependencies:
  - resource: AzureContainerRegistry.myacr
    isHardDependency: true
  - resource: AzureDnsZone.mydns

defaultConfig:
  image: ${ AzureContainerRegistry.myacr.server }/myapp:latest
  cpu: 0.5
  memory: 1Gi
  bindDnsZone:
    dnsZone: ${ AzureDnsZone.mydns.domainName }
    subDomain: myapp.${ this.region }.${ this.ring }

specificConfig:
  - ring: production
    cpu: 2
    memory: 4Gi

exports:
  fqdn: AzureContainerAppFqdn
```

### Key YAML Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✓ | Resource identifier (unique per ring+region) |
| `type` | ✓ | Resource type (e.g. `AzureContainerApp`, `AzureDnsZone`) |
| `project` | | Project prefix; omit for shared resources |
| `ring` | ✓ | `test`, `staging`, `production` — or an array |
| `region` | | `eastasia`, `koreacentral`, etc. — or an array |
| `authProvider` | ✓ | Auth provider name or `{name, ...args}` |
| `dependencies` | ✓ | Array of `{resource, isHardDependency?, authProvider?}` |
| `defaultConfig` | ✓ | Base configuration (resource-specific schema) |
| `specificConfig` | ✓ | Array of per-ring/region config overrides |
| `exports` | ✓ | Map of export name → ProprietyGetter name |

When `ring` and `region` are arrays, Merlin generates a cartesian product (e.g. 2 rings × 2 regions = 4 resources).

### Parameter Expressions

Config values can reference other resources using `${ }` expressions:

```yaml
# Reference another resource's export
image: ${ AzureContainerRegistry.myacr.server }/myapp:latest

# Reference the current resource's ring or region
subDomain: myapp.${ this.region }.${ this.ring }
```

At deploy time these are resolved to shell variable captures (`$MERLIN_ACR_MYACR_STG_EAS_SERVER`), so dry-run works even when resources don't exist yet.

## Multi-Cloud Support

Merlin supports multiple cloud providers via the `--cloud` flag (or `MERLIN_CLOUD` env variable):

```bash
# Deploy to Azure (default)
merlin deploy --input shared-resource/ --ring test --region koreacentral

# Deploy to Alibaba Cloud (Phase 2 — implementation in progress)
merlin deploy --input shared-resource/ --ring test --region cn-hangzhou --cloud alibaba
```

### Cloud-Agnostic Resource Types

Write YAML once, deploy to any cloud by using **cloud-agnostic type names**:

| Cloud-agnostic type | Azure implementation | Alibaba (Phase 2) |
|---------------------|---------------------|-------------------|
| `ContainerApp` | `AzureContainerApp` | SAE |
| `ContainerRegistry` | `AzureContainerRegistry` | ACR |
| `ContainerAppEnvironment` | `AzureContainerAppEnvironment` | SAE Namespace |
| `ObjectStorage` | `AzureBlobStorage` | OSS |
| `LogSink` | `AzureLogAnalyticsWorkspace` | SLS |
| `DnsZone` | `AzureDnsZone` | Alidns |
| `ServicePrincipal` | `AzureServicePrincipal` | RAM User |
| `AppRegistration` | `AzureADApp` | RAM Role |

Existing `Azure*` type names continue to work as-is — no migration required.

## Supported Resource Types

### Azure Resources

| Type | Description |
|------|-------------|
| `AzureContainerApp` | Container Apps with optional DNS binding and EasyAuth |
| `AzureContainerAppEnvironment` | Container App Environments |
| `AzureContainerRegistry` | Container Registries |
| `AzureLogAnalyticsWorkspace` | Log Analytics Workspaces |
| `AzureDnsZone` | DNS Zones (with optional NS delegation to parent zone) |
| `AzureADApp` | Azure AD / Entra ID App Registrations |
| `AzureServicePrincipal` | Service Principals with Federated Credentials (OIDC) and Role Assignments |
| `AzureBlobStorage` | Blob Storage Accounts |
| `AzureKeyVault` | Key Vaults |
| `AzureRedisEnterprise` | Redis Enterprise (stub) |
| `AzurePostgreSQLFlexible` | PostgreSQL Flexible Server (stub) |
| `AzureFunctionApp` | Azure Function Apps (stub) |
| `AzureResourceGroup` | Resource Groups (auto-created, deduplicated) |

### Kubernetes Resources

| Type | Description |
|------|-------------|
| `KubernetesCluster` | AKS clusters (with auto-namespace creation, ACR attach, Workload Identity) |
| `KubernetesDeployment` | Deployments (with probes, env vars, CSI secret volumes, workload identity) |
| `KubernetesService` | ClusterIP Services |
| `KubernetesIngress` | Ingress resources (with cert-manager TLS, optional DNS A-record binding) |
| `KubernetesHelmRelease` | Helm chart installations (with preCommands, values overrides) |
| `KubernetesConfigMap` | ConfigMaps |
| `KubernetesServiceAccount` | Service Accounts (with workload identity annotations) |
| `KubernetesManifest` | Raw Kubernetes manifests (SecretProviderClass, ClusterIssuer, etc.) |

## Repository Structure

```
merlin/
├── src/
│   ├── merlin.ts                    # CLI entry point (Commander.js)
│   ├── deployer.ts                  # Deployment orchestration (DAG executor)
│   ├── init.ts                      # Registers all providers/renders/getters
│   ├── runtime.ts                   # Public API for generated code
│   ├── common/
│   │   ├── compiler.ts              # Compiler pipeline orchestration
│   │   ├── constants.ts             # Package name/version constants
│   │   ├── registry.ts              # Resource registry (name:ring:region → Resource)
│   │   ├── resource.ts              # Core types, render/auth registries, Region enum
│   │   ├── cloudTypes.ts            # Cloud-agnostic resource type constants
│   │   └── paramResolver.ts         # Runtime ${ } expression resolver
│   ├── compiler/
│   │   ├── parser.ts                # YAML → raw resource objects
│   │   ├── validator.ts             # Zod schema + semantic validation
│   │   ├── transformer.ts           # Ring×region expansion, config merging
│   │   ├── generator.ts             # TypeScript code generation
│   │   ├── initializer.ts           # .merlin/ pnpm project setup
│   │   ├── deploy-script-generator.ts # Deploy script generation
│   │   └── schemas.ts               # Zod schemas for YAML validation
│   ├── azure/                       # Azure resource renders
│   ├── kubernetes/                  # Kubernetes resource renders
│   └── alibaba/                     # Alibaba Cloud provider (Phase 2 placeholder)
│
├── shared-resource/                 # Cross-project shared Azure infrastructure
│   ├── sharedacr.yml                # Container Registry
│   ├── sharedredis.yml              # Redis Enterprise
│   ├── sharedpsql.yml               # PostgreSQL Flexible
│   ├── sharedabs.yml                # Blob Storage
│   ├── sharedakv.yml                # Key Vault
│   └── sharedgithubsp.yml           # GitHub Actions SP (OIDC)
│
├── shared-k8s-resource/             # Shared Kubernetes infrastructure
│   ├── sharedaks.yml                # AKS cluster (Workload Identity, CSI, Azure CNI)
│   ├── sharedingressnginx.yml       # NGINX Ingress Controller (Helm)
│   ├── sharedcertmanager.yml        # cert-manager (Helm)
│   ├── sharedletsencryptissuer.yml  # Let's Encrypt ClusterIssuer
│   └── sharedkvsp.yml               # Key Vault workload identity SP
│
├── synapse-k8s-resource/            # Synapse AI gateway (koreacentral only)
├── alluneed-k8s-resource/           # Alluneed AI inference service
│
└── .merlin/                         # Generated TypeScript project (git-ignored)
```

> **Note:** Trinity resources have been moved to the [trinity repo](https://github.com/TheDeltaLab/trinity).
> Each project maintains its own `merlin-resources/` directory and installs `@thedeltalab/merlin` as a dependency.
> Shared resources (`shared-resource/`, `shared-k8s-resource/`) are bundled in the npm package and auto-included during compile/deploy.

## Deploying

### From a project repo (e.g. trinity)

```bash
# Dry-run (preview commands)
pnpm exec merlin deploy ./merlin-resources --ring staging --region koreacentral

# Execute deployment
pnpm exec merlin deploy ./merlin-resources --execute --ring staging --region koreacentral

# Skip auto-including shared resources
pnpm exec merlin deploy ./merlin-resources --no-shared --ring staging --region koreacentral
```

### From the merlin repo (shared infrastructure)

```bash
# Deploy shared Azure resources
merlin deploy shared-resource --execute --ring staging --region koreacentral

# Deploy shared K8s infrastructure (AKS, NGINX, cert-manager)
merlin deploy shared-k8s-resource --execute --ring staging --region koreacentral
```

## Development

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm lint          # Lint
pnpm lint:fix      # Lint and auto-fix
```

### Adding New Resource Types

1. Create `src/azure/azureNewResource.ts` — export type constant + `AzureNewResourceRender extends AzureResourceRender`
2. Register in `src/init.ts`: `registerRender(AZURE_NEW_RESOURCE_TYPE, new AzureNewResourceRender())`
3. Add Zod schema entry in `src/compiler/schemas.ts` if needed
4. Write tests in `src/azure/test/azureNewResource.test.ts`

See `CLAUDE.md` for full architecture details and conventions.

## License

ISC
