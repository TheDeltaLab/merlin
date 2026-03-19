# Merlin

Declarative Infrastructure as Code (IaC) tool. Define resources in YAML, compile to TypeScript, deploy via cloud CLI (Azure / Alibaba Cloud).

## Overview

Merlin follows a **compile-time + runtime** architecture:

1. **Compile** — YAML resource definitions → TypeScript code (output to `.merlin/`)
2. **Deploy** — TypeScript is executed to render CLI commands for the target cloud, which are then run (or previewed)

## Installation

```bash
pnpm install
pnpm build
pnpm link:global
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
| `AzureResourceGroup` | Resource Groups (auto-created, deduplicated) |

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
│   │   └── schemas.ts               # Zod schemas for YAML validation
│   └── azure/
│       ├── render.ts                # AzureResourceRender base class + naming
│       ├── azureContainerApp.ts     # ACA render (create/update/DNS bind/EasyAuth)
│       ├── azureContainerAppEnvironment.ts
│       ├── azureContainerRegistry.ts
│       ├── azureDnsZone.ts          # DNS Zone render (+ NS delegation)
│       ├── azureADApp.ts            # AD App render (global resource)
│       ├── azureServicePrincipal.ts # SP render (OIDC federated creds + RBAC)
│       ├── azureBlobStorage.ts
│       ├── azureLogAnalyticsWorkspace.ts
│       ├── resourceGroup.ts
│       ├── proprietyGetter.ts       # ProprietyGetter implementations
│       └── authProvider.ts          # AuthProvider implementations
│   └── alibaba/
│       └── index.ts                 # Alibaba Cloud provider (Phase 2 placeholder)
│
├── shared-resource/                 # Cross-project shared infrastructure (project: merlin)
│   ├── sharedredis.yml              # Redis Enterprise
│   ├── sharedpsql.yml               # PostgreSQL Flexible
│   ├── sharedabs.yml                # Blob Storage
│   ├── sharedakv.yml                # Key Vault
│   └── sharedgithubsp.yml           # GitHub Actions SP (trinity + alluneed OIDC)
│
├── trinity-resource/                # Trinity shared infrastructure (project: merlin)
│   ├── trinitylaw.yml               # Log Analytics Workspace (for all trinity services)
│   └── trinityacenv.yml             # Container App Environment (for all trinity services)
│
├── trinity-web-resource/            # Trinity Web frontend
├── trinity-worker-resource/         # Trinity Worker + AD App
├── trinity-admin-resource/          # Trinity Admin + AD App + DNS Zone
├── trinity-lance-resource/          # Trinity Lance (AI backend)
├── trinity-lance-worker-resource/   # Trinity Lance Worker
├── trinity-home-resource/           # Trinity Home (marketing site)
├── trinity-func-resource/           # Trinity Azure Functions
│
├── alluneed-resource/               # Alluneed AI inference service
│   ├── alluneedaca.yml              # Container App (uses GHCR, own ACAE)
│   ├── alluneedacenv.yml            # Dedicated Container App Environment
│   ├── alluneedlaw.yml              # Dedicated Log Analytics Workspace
│   ├── alluneedadapp.yml            # AD App for EasyAuth
│   └── chuangdnszone.yml            # DNS Zone
│
├── deploy-trinity.sh                # Deploy all trinity + alluneed resources
├── print-github-config.sh           # Print GitHub Secrets/Variables for CI
└── .merlin/                         # Generated TypeScript project (git-ignored)
```

### Why each project has its own ACAE + LAW

Alluneed is an AI inference service that consumes 4 CPU / 8 Gi per replica. Sharing a Container App Environment with Trinity would create resource competition (shared CPU/memory quota, shared egress IP, shared maintenance windows). Each project therefore has its own environment:

| Resource | Trinity | Alluneed |
|----------|---------|---------|
| Container Registry | `ghcr.io/thedeltalab/trinity/*` (GHCR) | `ghcr.io/thedeltalab/alluneed` (GHCR) |
| ACAE | `AzureContainerAppEnvironment.trinity` | `AzureContainerAppEnvironment.alluneed` |
| LAW | `AzureLogAnalyticsWorkspace.trinity` | `AzureLogAnalyticsWorkspace.alluneed` |

## Deploying

```bash
# Dry-run (preview commands) for test ring, koreacentral
./deploy-trinity.sh

# Execute deployment for staging ring, eastasia
./deploy-trinity.sh --ring staging --region eastasia --execute

# Print GitHub Actions config after first deploy
./print-github-config.sh --ring test
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
