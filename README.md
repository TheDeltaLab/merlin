# Merlin

CLI tool for Infrastructure as Code deployment and management

## Overview

Merlin is a declarative infrastructure deployment tool designed to automate the creation and management of cloud resources, with a focus on Azure services. It allows you to define your infrastructure in YAML configuration files and automatically handles resource creation, dependency resolution, permission management, and environment configuration.

## Features

- **Declarative Configuration**: Define your infrastructure using simple YAML files
- **Automatic Dependency Resolution**: Topological sorting ensures resources are created in the correct order
- **Multi-environment Support**: Manage different rings (test, staging, production) and regions
- **Permission Management**: Automatic setup of authentication and authorization between resources
- **Dry Run Mode**: Preview changes before applying them
- **Extensible Architecture**: Easy to add support for new resource types

## Installation

```bash
pnpm install
pnpm build
pnpm link:global
```

## Usage

### Deploy Infrastructure

```bash
# Deploy all resources
merlin deploy

# Dry run mode (preview changes without applying)
merlin deploy --dry-run

# Deploy to specific ring and region
merlin deploy --ring production --region eastus
```

### Validate Configuration

```bash
# Validate all configuration files
merlin validate

# Validate specific file
merlin validate resources/worker.yml
```

## Configuration

Resources are defined in YAML files under the `resources/` directory. See the [design document](docs/design.md) for detailed configuration schema.

### Example Resource Configuration

```yaml
name: worker
type: AzureContainerApp
parent: cae
ring:
  - test
  - production
region:
  - eastus
  - westus
authProvider: microsoftIdentityProviderAuth

dependencies:
  - resource: acr
    isHardDependency: true
  - resource: postgresql
  - resource: redis

defaultConfig:
  cpu: 2
  memory: 4Gi
  env:
    - name: REDIS_URL
      value: ${ redis.connectionString }
    - name: DATABASE_URL
      value: ${ postgresql.connectionString }

specificConfig:
  - ring: production
    region: eastus
    cpu: 4
    memory: 8Gi

exports:
  - url: getResourceUrl
  - identity: getResourceIdentity
```

## Development

### Project Structure

```
merlin/
├── src/
│   ├── merlin.ts           # CLI entry point
│   ├── types/              # Type definitions
│   ├── render/             # Resource renderers
│   ├── actions/            # Authentication and permission actions
│   └── utils/              # Utility functions
├── docs/                   # Documentation
└── resources/              # Resource configuration files
```

### Available Scripts

- `pnpm dev` - Run the CLI in development mode
- `pnpm build` - Build the project
- `pnpm test` - Run tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm lint` - Lint code
- `pnpm lint:fix` - Lint and fix code

### Adding New Resource Types

1. Define the resource schema in `src/types/`
2. Create a renderer in `src/render/`
3. Register the resource type in the main execution flow
4. Add tests for the new resource type

## Architecture

Merlin follows a declarative approach where you specify the desired state of your infrastructure, and the tool handles the execution details:

1. **Load Resources**: Parse YAML configuration files
2. **Validate Dependencies**: Ensure all dependencies exist and are valid
3. **Topological Sort**: Determine the correct order for resource creation
4. **Render Commands**: Convert resource definitions to executable commands
5. **Execute**: Run commands or show dry-run preview

## License

ISC
