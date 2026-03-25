import { Command } from 'commander';
import { Compiler } from './common/compiler.js';
import { execaCommand } from 'execa';
import { execSync } from 'child_process';
import * as path from 'path';

const program = new Command();

program
    .name('merlin')
    .description('CLI tool for Infrastructure as Code deployment and management')
    .version('0.1.0');

program
    .command('compile')
    .description('Compile YAML resource definitions to TypeScript')
    .argument('[path]', 'Path to YAML file or directory', './resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths>', 'Additional resource directories to compile alongside the main path (comma-separated)')
    .option('-o, --output <path>', 'Output directory', '.merlin')
    .option('-w, --watch', 'Watch for changes and recompile')
    .option('--validate-only', 'Validate without generating code')
    .option('--no-cache', 'Skip the compilation cache and always recompile')
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        const extraPaths: string[] = options.also
            ? options.also.split(',').map((p: string) => p.trim()).filter(Boolean)
            : [];
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: options.output,
                watch: options.watch,
                validate: options.validateOnly,
                skipCache: !options.cache
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
    .argument('[path]', 'Path to resource configuration file or directory', './resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths>', 'Additional resource directories to compile alongside the main path (comma-separated)')
    .option('-e, --execute', 'Actually execute the deployment (default is dry-run)')
    .option('-r, --ring <ring>', 'Target ring (test, staging, production)')
    .option('--region <region>', 'Target region (eastus, westus, krc)')
    .option('--dir <path>', 'Compiled output directory', '.merlin')
    .option('-o, --output-file <file>', 'Write generated commands to file')
    .option('-c, --concurrency <number>', 'Max parallel resource deployments per level (default: 4)', '4')
    .option('--cloud <cloud>', 'Cloud provider: azure (default) | alibaba', 'azure')
    .action(async (argPath, options) => {
        const resourcePath = options.input ?? argPath;
        const outputPath = options.dir;
        const extraPaths: string[] = options.also
            ? options.also.split(',').map((p: string) => p.trim()).filter(Boolean)
            : [];

        try {
            // Auto-compile before deployment
            console.log('🔨 Compiling resources...');
            const compiler = new Compiler();

            const compileResult = await compiler.compile({
                inputPath: resourcePath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: outputPath
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

            if (options.ring) {
                args.push('--ring', options.ring);
            }

            if (options.region) {
                args.push('--region', options.region);
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
    .argument('[path]', 'Path to resource configuration file or directory', './resources')
    .option('-i, --input <path>', 'Path to YAML resource definitions directory (overrides [path] argument)')
    .option('--also <paths>', 'Additional resource directories to validate alongside the main path (comma-separated)')
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        const extraPaths: string[] = options.also
            ? options.also.split(',').map((p: string) => p.trim()).filter(Boolean)
            : [];
        // Auto-compile before validation (user preference)
        console.log('🔨 Compiling resources...');
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
                inputPaths: extraPaths.length > 0 ? extraPaths : undefined,
                outputPath: '.merlin'
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

program.parse();
