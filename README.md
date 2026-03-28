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
│   ├── azure/
│   │   ├── render.ts                # AzureResourceRender base class + naming
│   │   ├── azureContainerApp.ts     # ACA render (create/update/DNS bind/EasyAuth)
│   │   ├── azureContainerRegistry.ts
│   │   ├── azureDnsZone.ts          # DNS Zone render (+ NS delegation)
│   │   ├── azureServicePrincipal.ts # SP render (OIDC federated creds + RBAC)
│   │   ├── azureBlobStorage.ts
│   │   ├── azureKeyVault.ts
│   │   ├── azureLogAnalyticsWorkspace.ts
│   │   ├── proprietyGetter.ts       # ProprietyGetter implementations
│   │   └── authProvider.ts          # AuthProvider implementations
│   ├── kubernetes/
│   │   ├── kubernetesCluster.ts     # AKS cluster render (node pools, ACR attach, namespaces)
│   │   ├── kubernetesDeployment.ts  # Deployment render (containers, probes, volumes)
│   │   ├── kubernetesService.ts     # Service render (ClusterIP)
│   │   ├── kubernetesIngress.ts     # Ingress render (TLS, DNS A-record binding)
│   │   ├── kubernetesHelmRelease.ts # Helm release render (preCommands, values)
│   │   ├── kubernetesConfigMap.ts   # ConfigMap render
│   │   ├── kubernetesServiceAccount.ts # ServiceAccount render (workload identity)
│   │   ├── kubernetesNamespace.ts   # Namespace render + manifestToYaml utility
│   │   └── kubernetesManifest.ts    # Raw manifest render (SPC, ClusterIssuer, etc.)
│   └── alibaba/
│       └── index.ts                 # Alibaba Cloud provider (Phase 2 placeholder)
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
├── trinity-k8s-resource/            # Trinity application (6 microservices on K8s)
│   ├── trinityworkloadsa.yml        # Workload Identity ServiceAccount
│   ├── trinitysharedconfig.yml      # Shared ConfigMap (env vars)
│   ├── trinitysecretprovider.yml    # CSI SecretProviderClass (DB, JWT secrets)
│   ├── trinitylancesecretprovider.yml # Lance SecretProviderClass (AI API keys)
│   ├── trinity{web,home,admin,worker,lance,lance-worker}deployment.yml
│   ├── trinity{web,home,admin,worker,lance,lance-worker}svc.yml
│   └── trinity{web,home,admin}ingress.yml  # External access + DNS + TLS
│
├── synapse-k8s-resource/            # Synapse AI gateway (koreacentral only)
│   ├── synapseworkloadsa.yml
│   ├── synapsesharedconfig.yml
│   ├── synapsesecretprovider.yml
│   ├── synapse{gateway,dashboard}deployment.yml
│   ├── synapse{gateway,dashboard}svc.yml
│   └── synapsedashboardingress.yml
│
├── alluneed-k8s-resource/           # Alluneed AI inference service
│   ├── alluneedworkloadsa.yml
│   ├── alluneedsecretprovider.yml
│   ├── alluneeddeployment.yml       # Heavy: 4 CPU / 8 Gi (ML inference)
│   ├── alluneedsvc.yml
│   └── alluneedingress.yml
│
├── trinity-func-resource/           # Trinity Azure Functions (stub)
│
├── trinity-resource/                # (Legacy) Trinity ACA infrastructure — LAW + ACAE
├── trinity-*-resource/              # (Legacy) Trinity ACA services
├── alluneed-resource/               # (Legacy) Alluneed ACA resources
│
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
