# Merlin

Declarative Infrastructure as Code (IaC) tool for Azure. Define resources in YAML, compile to TypeScript, deploy via Azure CLI.

## Overview

Merlin follows a **compile-time + runtime** architecture:

1. **Compile** — YAML resource definitions → TypeScript code (output to `.merlin/`)
2. **Deploy** — TypeScript is executed to render Azure CLI commands, which are then run (or previewed)

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

## Supported Resource Types

| Type | Description |
|------|-------------|
| `AzureContainerApp` | Container Apps with optional DNS binding and EasyAuth |
| `AzureContainerAppEnvironment` | Container App Environments |
| `AzureContainerRegistry` | Container Registries |
| `AzureLogAnalyticsWorkspace` | Log Analytics Workspaces |
| `AzureDnsZone` | DNS Zones (with optional NS delegation to parent zone) |
| `AzureADApp` | Azure AD / Entra ID App Registrations |
| `AzureBlobStorage` | Blob Storage Accounts |
| `AzureResourceGroup` | Resource Groups (auto-created, deduplicated) |

## Project Structure

```
merlin/
├── src/
│   ├── merlin.ts                  # CLI entry point (Commander.js)
│   ├── deployer.ts                # Deployment orchestration (DAG executor)
│   ├── init.ts                    # Registers all providers/renders/getters
│   ├── runtime.ts                 # Public API for generated code
│   ├── common/
│   │   ├── compiler.ts            # Compiler pipeline orchestration
│   │   ├── registry.ts            # Resource registry (name:ring:region → Resource)
│   │   ├── resource.ts            # Core types, render/auth registries
│   │   └── paramResolver.ts       # Runtime ${ } expression resolver
│   ├── compiler/
│   │   ├── parser.ts              # YAML → raw resource objects
│   │   ├── validator.ts           # Zod schema + semantic validation
│   │   ├── transformer.ts         # Ring×region expansion, config merging
│   │   ├── generator.ts           # TypeScript code generation
│   │   ├── initializer.ts         # .merlin/ pnpm project setup
│   │   └── schemas.ts             # Zod schemas for YAML validation
│   └── azure/
│       ├── render.ts              # AzureResourceRender base class + naming
│       ├── azureContainerApp.ts   # ACA render (create/update/DNS bind/EasyAuth)
│       ├── azureContainerAppEnv.ts
│       ├── azureContainerRegistry.ts
│       ├── azureDnsZone.ts        # DNS Zone render (+ NS delegation)
│       ├── azureADApp.ts          # AD App render (global resource)
│       ├── azureBlobStorage.ts
│       ├── azureLogAnalyticsWorkspace.ts
│       ├── resourceGroup.ts
│       ├── proprietyGetter.ts     # ProprietyGetter implementations
│       └── authProvider.ts        # AuthProvider implementations
├── resources/                     # YAML resource definitions (user input)
└── .merlin/                       # Generated TypeScript project (git-ignored)
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
