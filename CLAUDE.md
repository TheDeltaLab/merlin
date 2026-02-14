# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Merlin is a declarative Infrastructure as Code (IaC) tool that compiles YAML resource definitions into TypeScript, then executes deployment commands. It follows a compile-time + runtime architecture where YAML files are compiled to TypeScript, which are then executed to generate Azure CLI commands for infrastructure deployment.

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
   - Render resources to deployment commands (Azure CLI)
   - Execute or output commands

### Key Directories

- **`src/merlin.ts`**: CLI entry point with Commander.js commands
- **`src/compiler/`**: Compile-time logic (parser, validator, transformer, generator)
- **`src/common/`**: Shared types and resource registry
- **`src/azure/`**: Azure-specific resource types, renders, and auth providers
- **`src/runtime.ts`**: Public API for generated code
- **`src/init.ts`**: Registers all providers (auth, render, propriety getters)
- **`resources/`**: YAML resource definitions (user input)
- **`.merlin/`**: Generated TypeScript project (output, not in git)

### Compiler Pipeline

The compiler follows this pipeline (see `src/common/compiler.ts`):

1. **Discovery**: Find all `.yml`/`.yaml` files
2. **Parse**: Parse YAML with syntax error handling (`parser.ts`)
3. **Validate**: Schema validation with Zod + semantic validation (`validator.ts`, `schemas.ts`)
4. **Transform**: Expand ring×region cartesian product, merge `defaultConfig` + `specificConfig` (`transformer.ts`)
5. **Generate**: Generate TypeScript code with resource objects and registrations (`generator.ts`)
6. **Initialize**: Setup `.merlin/` as pnpm project with tsup build config (`initializer.ts`)
7. **Build**: Run `pnpm build` in `.merlin/` to bundle TypeScript

### Resource Lifecycle

1. **YAML Definition** → Define resource in `resources/*.yml` with `name`, `type`, `ring`, `region`, `authProvider`, `dependencies`, `defaultConfig`, `specificConfig`, `exports`
2. **Compilation** → YAML compiled to TypeScript resource objects
3. **Registration** → Resources auto-register in runtime registry (`registerResource()`)
4. **Deployment** → Deployment script loads all resources, resolves dependencies, renders commands

### Registry Pattern

Merlin uses registries (global Maps) for runtime lookup:

- **Resource Registry** (`common/registry.ts`): Maps `name:ring:region` → `Resource`
- **Render Registry** (`common/resource.ts`): Maps `resourceType` → `Render` implementation
- **Auth Provider Registry**: Maps `authProviderName` → `AuthProvider` implementation
- **Propriety Getter Registry**: Maps `getterName` → `ProprietyGetter` implementation

All registrations happen in `src/init.ts` and are imported by generated code via `import 'merlin/init.js'`.

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

     async render(resource: Resource): Promise<Command[]> {
       // Return array of Command objects with Azure CLI commands
     }
   }
   ```

3. **Register the render** in `src/init.ts`:
   ```typescript
   import { AZURE_NEW_RESOURCE_TYPE, AzureNewResourceRender } from './azure/newResource.js';
   registerRender(AZURE_NEW_RESOURCE_TYPE, new AzureNewResourceRender());
   ```

4. **Add the resource type to schemas** (optional, for stricter validation) in `src/compiler/schemas.ts`

5. **Create YAML definitions** in `resources/` using the new `type` field

6. **Write tests** in `src/azure/test/` or similar location

## YAML Resource Schema

Key fields in resource YAML files:

- **`name`** (required): Resource identifier, unique per ring+region
- **`type`** (required): Resource type (e.g., `AzureBlobStorage`, `AzureContainerApp`)
- **`project`** (optional): Project name (omit for shared resources)
- **`ring`** (required): Single value or array - `test`, `staging`, `production`
- **`region`** (optional): Single value or array - `eastus`, `westus`, `eastasia`, `koreacentral`, `koreasouth`
- **`parent`** (optional): Parent resource name (e.g., container apps need container environment)
- **`authProvider`** (required): Auth provider name or `{name, ...args}`
- **`dependencies`** (required): Array of `{resource, isHardDependency?, authProvider?}`
- **`defaultConfig`** (required): Base configuration object (resource-specific schema)
- **`specificConfig`** (required): Array of config overrides with optional `ring`/`region` filters
- **`exports`** (required): Object mapping export name to propriety getter (string or `{name, ...args}`)

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

## Important Development Notes

- **Do not commit `.merlin/`** - it's generated output (in `.gitignore`)
- **Import `init.js` before `runtime.js`** - ensures providers are registered before resources load
- **Registry initialization is side-effectful** - `src/init.ts` registers providers on import
- **Zod schemas in `schemas.ts`** - update these for YAML validation changes
- **Deep merge semantics** - objects merge recursively, arrays/primitives replace
- **Resource keys are unique** - `name:ring:region` must be unique across all resources
- **Test isolation** - use `clearRegistry()` in test teardown to reset global state
