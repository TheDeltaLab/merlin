import { Command } from 'commander';
import { Compiler } from './common/compiler.js';
import { execaCommand } from 'execa';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { resolveRing, resolveRegion } from './common/resolveNames.js';
import { MERLIN_PACKAGE_VERSION } from './common/constants.js';
import { loadCLIDefaults } from './cli/defaults.js';
import { confirmDeploy } from './cli/confirm.js';
import { runInit, TemplateName } from './cli/init.js';

const program = new Command();

/**
 * Parses --also flag values which can be repeated and/or comma-separated.
 * e.g. --also "a,b" --also c → ['a', 'b', 'c']
 */
function parseAlsoPaths(also: string | string[] | undefined): string[] {
    if (!also) return [];
    const values = Array.isArray(also) ? also : [also];
    return values
        .flatMap((p: string) => p.split(','))
        .map((p: string) => p.trim())
        .filter(Boolean);
}

/**
 * Checks that the resource path exists. If not, prints a friendly error
 * with guidance on how to fix it, then exits.
 */
function ensurePathExists(resourcePath: string): void {
    if (!existsSync(resourcePath)) {
        console.error(`❌ Resource path not found: ${resourcePath}\n`);
        if (resourcePath === './merlin-resources' || resourcePath === 'merlin-resources') {
            console.error('   This is a new project? Run merlin init to get started:\n');
            console.error('     merlin init <project-name>              # Web service template');
            console.error('     merlin init <project-name> --with-auth  # With OAuth2 authentication\n');
            console.error('   Or specify a different path:\n');
            console.error('     merlin <command> ./path/to/resources');
        } else {
            console.error(`   Directory "${resourcePath}" does not exist.`);
            console.error('   Check the path or run: merlin init <project-name>');
        }
        process.exit(1);
    }
}

program
    .name('merlin')
    .description('CLI tool for Infrastructure as Code deployment and management')
    .version(MERLIN_PACKAGE_VERSION)
    .addHelpText('after', `
Quick Start:
  $ merlin init myapp                  Create a new project with resource templates
  $ merlin init myapp --with-auth      Include OAuth2 authentication resources
  $ merlin compile                     Compile YAML resources to TypeScript
  $ merlin deploy                      Preview deployment commands (dry-run)
  $ merlin deploy --execute            Execute the deployment
  $ merlin list                        List resources and check cloud status

Ring/Region Short Names:
  Rings:    tst (test), stg (staging), prd (production)
  Regions:  krc (koreacentral), eas (eastasia), eus (eastus), wus (westus)

Examples:
  $ merlin deploy -r stg --region krc              Deploy to staging/koreacentral
  $ merlin deploy -r prd --execute --yes            Deploy to production (CI mode)
  $ merlin deploy shared-k8s-resource --execute --all  Deploy shared infra to all rings
  $ merlin list -r stg --region krc --no-status     List resources without status check

Help for a specific command:
  $ merlin help <command>              e.g. merlin help deploy, merlin help init
  $ merlin <command> --help            e.g. merlin deploy --help
`);

program
    .command('compile')
    .description('Compile YAML resource definitions to TypeScript')
    .argument('[path]', 'Path to YAML file or directory', './merlin-resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths...>', 'Additional resource directories to compile alongside the main path (repeatable, also supports comma-separated)')
    .option('-o, --output <path>', 'Output directory', '.merlin')
    .option('-w, --watch', 'Watch for changes and recompile')
    .option('--validate-only', 'Validate without generating code')
    .option('--no-cache', 'Skip the compilation cache and always recompile')
    .option('--no-shared', 'Do not auto-include shared resources from the merlin package')
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        ensurePathExists(inputPath);
        const extraPaths = parseAlsoPaths(options.also);
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: options.output,
                watch: options.watch,
                validate: options.validateOnly,
                skipCache: !options.cache,
                noShared: !options.shared
            });

            if (result.success) {
                if (result.cacheHit) {
                    console.log('⚡ Compilation skipped (cache hit — no YAML files changed)');
                } else {
                    console.log(`✅ Compiled ${result.generatedFiles.length} files`);
                    result.generatedFiles.forEach(f => console.log(`   - ${f}`));

                    // Check if build succeeded
                    const buildWarning = result.warnings.find(w => w.message.includes('Build failed'));
                    if (!buildWarning) {
                        console.log(`📦 Built output to ${options.output}/dist`);
                    }
                }

                if (result.warnings.length > 0) {
                    console.warn('\n⚠️  Warnings:');
                    result.warnings.forEach(warn => {
                        console.warn(`   ${warn.source}${warn.path ? ':' + warn.path : ''} - ${warn.message}`);
                        if (warn.hint) {
                            console.warn(`      💡 ${warn.hint}`);
                        }
                    });
                }
            } else {
                console.error('❌ Compilation failed:');
                result.errors.forEach(err => {
                    console.error(`   ${err.source}${err.path ? ':' + err.path : ''} - ${err.message}`);
                    if (err.hint) {
                        console.error(`      💡 ${err.hint}`);
                    }
                });
                process.exit(1);
            }

            if (options.watch) {
                console.log('\n👀 Watching for changes...');
                await compiler.watch({
                    inputPath: inputPath,
                    outputPath: options.output
                });
            }
        } catch (error) {
            console.error('Fatal error:', error);
            process.exit(1);
        }
    });

program
    .command('deploy')
    .description('Deploy infrastructure resources')
    .argument('[path]', 'Path to resource configuration file or directory', './merlin-resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths...>', 'Additional resource directories to compile alongside the main path (repeatable, also supports comma-separated)')
    .option('-e, --execute', 'Actually execute the deployment (default is dry-run)')
    .option('-r, --ring <ring>', 'Target ring (test, staging, production, or short: tst, stg, prd)')
    .option('--region <region>', 'Target region (koreacentral, eastasia, or short: krc, eas)')
    .option('--dir <path>', 'Compiled output directory', '.merlin')
    .option('-o, --output-file <file>', 'Write generated commands to file')
    .option('-c, --concurrency <number>', 'Max parallel resource deployments per level (default: 4)', '4')
    .option('--cloud <cloud>', 'Cloud provider: azure (default) | alibaba', 'azure')
    .option('--no-shared', 'Do not auto-include shared resources from the merlin package')
    .option('--k8s-only', 'Only deploy Kubernetes resources (skip Azure, GitHub, etc.)')
    .option('--all', 'Confirm deployment to all rings (required with --execute when no --ring)')
    .option('-y, --yes', 'Skip interactive confirmations (for CI/CD)')
    .addHelpText('after', `
Defaults:
  If merlin-resources/merlin.yml exists, --ring and --region default to its first values.
  Default mode is dry-run (preview commands). Add --execute to actually deploy.

Safety:
  --execute without --ring requires --all (prevents accidental all-ring deploy)
  --execute with --ring production requires interactive confirmation (or --yes for CI)

Examples:
  $ merlin deploy                              Dry-run with merlin.yml defaults
  $ merlin deploy --execute                    Deploy to default ring from merlin.yml
  $ merlin deploy -r stg --region krc          Dry-run staging/koreacentral
  $ merlin deploy -r stg --execute             Deploy to staging
  $ merlin deploy -r prd --execute --yes       Deploy to production (CI, skip confirm)
  $ merlin deploy shared-k8s-resource --execute --all  Deploy shared infra to all rings
  $ merlin deploy --also shared-resource --execute     Include shared resources
`)
    .action(async (argPath, options) => {
        const resourcePath = options.input ?? argPath;
        ensurePathExists(resourcePath);
        const outputPath = options.dir;
        const extraPaths = parseAlsoPaths(options.also);

        try {
            // Load merlin.yml defaults
            const defaults = loadCLIDefaults(resourcePath);
            if (defaults?.project) {
                console.log(`📋 Project: ${defaults.project} (from merlin.yml)`);
            }

            // Resolve ring/region: CLI explicit value > merlin.yml default
            const ring = options.ring ? resolveRing(options.ring) : defaults?.ring;
            const region = options.region ? resolveRegion(options.region) : defaults?.region;

            // Safety check
            const proceed = await confirmDeploy({
                execute: !!options.execute,
                ring,
                all: !!options.all,
                yes: !!options.yes,
            });
            if (!proceed) process.exit(1);

            // Auto-compile before deployment
            console.log('🔨 Compiling resources...');
            const compiler = new Compiler();

            const compileResult = await compiler.compile({
                inputPath: resourcePath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: outputPath,
                noShared: !options.shared
            });

            if (!compileResult.success) {
                console.error('❌ Compilation failed:');
                compileResult.errors.forEach(err => {
                    console.error(`   ${err.source}${err.path ? ':' + err.path : ''} - ${err.message}`);
                    if (err.hint) {
                        console.error(`      💡 ${err.hint}`);
                    }
                });
                process.exit(1);
            }

            if (compileResult.cacheHit) {
                console.log('⚡ Compilation skipped (cache hit)\n');
            } else {
                console.log(`✅ Compiled ${compileResult.generatedFiles.length} files\n`);
            }

            // Build the deploy command arguments
            const args: string[] = [];

            if (ring) {
                args.push('--ring', ring);
            }

            if (region) {
                args.push('--region', region);
            }

            if (options.outputFile) {
                // Convert relative path to absolute path
                const absoluteOutputFile = path.isAbsolute(options.outputFile)
                    ? options.outputFile
                    : path.resolve(process.cwd(), options.outputFile);
                args.push('--output', absoluteOutputFile);
            }

            if (options.concurrency) {
                args.push('--concurrency', options.concurrency);
            }

            if (!options.shared) {
                args.push('--no-shared');
            }

            if (options.k8sOnly) {
                args.push('--k8s-only');
            }

            if (options.execute) {
                // Use pnpm execute (which runs with --execute flag)
                console.log('🚀 Executing deployment...\n');
                await execaCommand('pnpm run execute ' + args.join(' '), {
                    cwd: outputPath,
                    stdio: 'inherit',
                    env: { ...process.env, MERLIN_CLOUD: options.cloud }
                });
            } else {
                // Use pnpm deploy (dry-run mode)
                console.log('📋 Generating deployment commands (dry-run mode)...\n');
                await execaCommand('pnpm run deploy ' + args.join(' '), {
                    cwd: outputPath,
                    stdio: 'inherit',
                    env: { ...process.env, MERLIN_CLOUD: options.cloud }
                });
            }
        } catch (error) {
            if (error instanceof Error && 'exitCode' in error) {
                // Command failed, but output was already shown
                process.exit((error as any).exitCode || 1);
            } else {
                console.error('❌ Deploy command failed:', error);
                process.exit(1);
            }
        }
    });

program
    .command('validate')
    .description('Validate resource configuration files')
    .argument('[path]', 'Path to resource configuration file or directory', './merlin-resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths...>', 'Additional resource directories to validate alongside the main path (repeatable, also supports comma-separated)')
    .option('--no-shared', 'Do not auto-include shared resources from the merlin package')
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        ensurePathExists(inputPath);
        const extraPaths = parseAlsoPaths(options.also);
        // Auto-compile before validation (user preference)
        console.log('🔨 Compiling resources...');
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: '.merlin',
                noShared: !options.shared
            });

            if (result.success) {
                console.log('✅ All resources are valid');

                if (result.warnings.length > 0) {
                    console.warn('\n⚠️  Warnings:');
                    result.warnings.forEach(warn => {
                        console.warn(`   ${warn.source}${warn.path ? ':' + warn.path : ''} - ${warn.message}`);
                        if (warn.hint) {
                            console.warn(`      💡 ${warn.hint}`);
                        }
                    });
                }
            } else {
                console.error('❌ Validation failed:');
                result.errors.forEach(err => {
                    console.error(`   ${err.source}${err.path ? ':' + err.path : ''} - ${err.message}`);
                    if (err.hint) {
                        console.error(`      💡 ${err.hint}`);
                    }
                });
                process.exit(1);
            }
        } catch (error) {
            console.error('Fatal error:', error);
            process.exit(1);
        }
    });

program
    .command('list')
    .description('List all resources managed by Merlin and check their actual status')
    .argument('[path]', 'Path to resource configuration file or directory', './merlin-resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths...>', 'Additional resource directories (repeatable, also supports comma-separated)')
    .option('--no-shared', 'Do not auto-include shared resources from the merlin package')
    .option('-r, --ring <ring>', 'Filter by ring (test, staging, production, or short: tst, stg, prd)')
    .option('--region <region>', 'Filter by region (koreacentral, eastasia, or short: krc, eas)')
    .option('--no-status', 'Skip querying actual Azure/K8s resource status')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Defaults:
  If merlin-resources/merlin.yml exists, --ring and --region default to its first values.
  By default, queries actual Azure/K8s status (use --no-status to skip).

Examples:
  $ merlin list                                List with defaults from merlin.yml
  $ merlin list -r stg --region krc            List staging/koreacentral resources
  $ merlin list --no-status                    List without cloud status check (fast)
  $ merlin list --json                         Output as JSON (for scripting)
  $ merlin list --json --no-status | jq .      Fast JSON listing
`)
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        ensurePathExists(inputPath);
        const extraPaths = parseAlsoPaths(options.also);
        const compiler = new Compiler();

        // Load merlin.yml defaults for ring/region
        const defaults = loadCLIDefaults(inputPath);

        // Resolve ring/region: CLI explicit value > merlin.yml default
        const ring = options.ring ? resolveRing(options.ring) : defaults?.ring;
        const region = options.region ? resolveRegion(options.region) : defaults?.region;

        try {
            const resources = await compiler.list({
                inputPath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                noShared: !options.shared,
                ring,
                region,
            });

            if (resources.length === 0) {
                console.log('No resources found.');
                return;
            }

            // Check actual status unless --no-status is set
            const checkStatus = options.status !== false;
            let statusResults: import('./common/statusChecker.js').ResourceStatusResult[] | undefined;

            if (checkStatus) {
                const { checkResourceStatuses } = await import('./common/statusChecker.js');
                console.error(`🔍 Checking status of ${resources.length} resource instances...\n`);
                statusResults = checkResourceStatuses(resources);
            }

            if (options.json) {
                const output = resources.map((r, i) => ({
                    name: r.name, type: r.type, ring: r.ring,
                    region: r.region ?? 'global', project: r.project ?? 'shared',
                    ...(statusResults ? {
                        cloudName: statusResults[i].cloudName,
                        status: statusResults[i].status,
                        detail: statusResults[i].detail,
                    } : {}),
                }));
                console.log(JSON.stringify(output, null, 2));
                return;
            }

            // Build a status lookup map: "type.name:ring:region" → status result
            const statusMap = new Map<string, import('./common/statusChecker.js').ResourceStatusResult>();
            if (statusResults) {
                for (const sr of statusResults) {
                    const key = `${sr.resource.type}.${sr.resource.name}:${sr.resource.ring}:${sr.resource.region ?? 'global'}`;
                    statusMap.set(key, sr);
                }
            }

            if (checkStatus) {
                // Status mode: one line per instance, showing the full cloud resource name
                const W_STATUS = 3, W_TYPE = 28, W_CLOUD_NAME = 50;
                console.log(`  ${''.padEnd(W_STATUS)} ${'Type'.padEnd(W_TYPE)} ${'Cloud Resource Name'.padEnd(W_CLOUD_NAME)} Detail`);
                console.log(`  ${''.padEnd(W_STATUS)} ${'─'.repeat(W_TYPE)} ${'─'.repeat(W_CLOUD_NAME)} ${'─'.repeat(20)}`);

                for (const r of resources) {
                    const statusKey = `${r.type}.${r.name}:${r.ring}:${r.region ?? 'global'}`;
                    const sr = statusMap.get(statusKey);
                    const icon = statusIcon(sr?.status);
                    const cloudName = sr?.cloudName ?? r.name;
                    const detail = sr?.detail ?? '';
                    console.log(`  ${icon}  ${r.type.padEnd(W_TYPE)} ${cloudName.padEnd(W_CLOUD_NAME)} ${detail}`);
                }
            } else {
                // No-status mode: show cloud name via getCloudResourceName
                const { getCloudResourceName } = await import('./common/statusChecker.js');
                const W_TYPE = 28, W_CLOUD_NAME = 50, W_RING = 12;
                console.log('');
                console.log(`  ${'Type'.padEnd(W_TYPE)} ${'Cloud Resource Name'.padEnd(W_CLOUD_NAME)} ${'Ring'.padEnd(W_RING)} Region`);
                console.log(`  ${'─'.repeat(W_TYPE)} ${'─'.repeat(W_CLOUD_NAME)} ${'─'.repeat(W_RING)} ${'─'.repeat(15)}`);

                for (const r of resources) {
                    const cloudName = getCloudResourceName(r);
                    console.log(`  ${r.type.padEnd(W_TYPE)} ${cloudName.padEnd(W_CLOUD_NAME)} ${r.ring.padEnd(W_RING)} ${r.region ?? 'global'}`);
                }
            }

            // Summary
            const total = resources.length;
            const uniqueCount = new Set(resources.map(r => `${r.type}.${r.name}`)).size;
            if (statusResults) {
                const exists = statusResults.filter(r => r.status === 'exists').length;
                const notFound = statusResults.filter(r => r.status === 'not-found').length;
                const skipped = statusResults.filter(r => r.status === 'skip').length;
                const errored = statusResults.filter(r => r.status === 'error').length;
                console.log('');
                console.log(`  Total: ${uniqueCount} resources (${total} instances)`);
                console.log(`  ✅ ${exists} exists   ❌ ${notFound} not found${skipped > 0 ? `   ⊘ ${skipped} skipped` : ''}${errored > 0 ? `   ⚠️  ${errored} errors` : ''}`);
            } else {
                console.log('');
                console.log(`  Total: ${uniqueCount} resources (${total} instances)`);
            }
            console.log('');
        } catch (error) {
            console.error('❌ Failed to list resources:', error instanceof Error ? error.message : error);
            process.exit(1);
        }
    });

function statusIcon(status?: string): string {
    switch (status) {
        case 'exists':    return '✅';
        case 'not-found': return '❌';
        case 'error':     return '⚠️ ';
        case 'skip':      return '⊘ ';
        default:          return '  ';
    }
}

program
    .command('prerequisites')
    .alias('prereqs')
    .description('Check and install required CLI tools (az, helm, kubectl)')
    .option('--install', 'Auto-install missing tools via Homebrew (macOS only)')
    .action(async (options) => {
        type Tool = {
            name: string;
            cmd: string;
            versionArg: string;
            installCmd?: string;
            installDoc: string;
        };

        const tools: Tool[] = [
            {
                name: 'Azure CLI (az)',
                cmd: 'az',
                versionArg: 'version --query \'"azure-cli"\' -o tsv',
                installCmd: 'brew install azure-cli',
                installDoc: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli',
            },
            {
                name: 'Helm',
                cmd: 'helm',
                versionArg: 'version --short',
                installCmd: 'brew install helm',
                installDoc: 'https://helm.sh/docs/intro/install/',
            },
            {
                name: 'kubectl',
                cmd: 'kubectl',
                versionArg: 'version --client --short',
                installCmd: 'brew install kubectl',
                installDoc: 'https://kubernetes.io/docs/tasks/tools/',
            },
        ];

        let allOk = true;

        console.log('Checking required tools...\n');

        for (const tool of tools) {
            try {
                const version = execSync(`${tool.cmd} ${tool.versionArg} 2>/dev/null`, {
                    encoding: 'utf-8',
                }).trim().split('\n')[0];
                console.log(`  ✅ ${tool.name}: ${version}`);
            } catch {
                allOk = false;
                console.log(`  ❌ ${tool.name}: not found`);
                console.log(`     Install: ${tool.installDoc}`);

                if (options.install && tool.installCmd) {
                    const isMac = process.platform === 'darwin';
                    if (!isMac) {
                        console.log(`     ⚠️  Auto-install only supported on macOS. Please install manually.`);
                        continue;
                    }
                    try {
                        console.log(`     🔧 Running: ${tool.installCmd}`);
                        execSync(tool.installCmd, { stdio: 'inherit' });
                        console.log(`     ✅ ${tool.name} installed successfully`);
                        allOk = true;
                    } catch {
                        console.error(`     ❌ Auto-install failed. Please install manually.`);
                    }
                }
            }
        }

        console.log('');

        if (allOk) {
            console.log('✅ All prerequisites satisfied.\n');
            console.log('Next steps:');
            console.log('  1. az login                                     # Authenticate with Azure');
            console.log('  2. merlin deploy shared-k8s-resource --execute  # Create AKS cluster + NGINX + cert-manager');
            console.log('  3. merlin deploy <project>-k8s-resource --execute  # Deploy application resources');
        } else {
            console.log('⚠️  Some tools are missing. Run with --install to auto-install on macOS.');
            console.log('   merlin prerequisites --install');
            process.exit(1);
        }
    });

program
    .command('init')
    .description('Initialize a new Merlin project with resource templates')
    .argument('[name]', 'Project name (defaults to current directory name)')
    .option('-t, --template <type>', 'Template type: web (default), worker, api, minimal', 'web')
    .option('--with-auth', 'Include OAuth2 proxy + Azure AD App authentication resources')
    .option('--dir <path>', 'Output directory', './merlin-resources')
    .addHelpText('after', `
Templates:
  web (default)   Web service with Ingress + ServiceAccount + SecretProviderClass (4 files)
  web --with-auth Web service + OAuth2 proxy + Azure AD App Registration (7 files)
  api             API service with Ingress, no auth annotations (4 files)
  worker          Background worker, no Ingress (4 files)
  minimal         Just merlin.yml + KubernetesApp (2 files)

Examples:
  $ merlin init myapp                        Web service template
  $ merlin init myapp --with-auth            Web + OAuth2 authentication (7 files)
  $ merlin init myworker --template worker   Background worker template
  $ merlin init myapi --template api         API service template

Generated files (web template):
  merlin-resources/
    merlin.yml              Project config (ring, region defaults)
    <name>.yml              KubernetesApp (main service)
    <name>workloadsa.yml    ServiceAccount (Workload Identity)
    <name>secretprovider.yml SecretProviderClass (Key Vault CSI)
`)
    .action(async (name, options) => {
        const projectName = name || path.basename(process.cwd());
        await runInit(projectName, {
            template: options.template as TemplateName,
            withAuth: !!options.withAuth,
            dir: options.dir,
        });
    });

program.parse();
