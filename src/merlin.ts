import { Command } from 'commander';
import { Compiler } from './common/compiler.js';
import { execaCommand } from 'execa';
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
    .option('-o, --output <path>', 'Output directory', '.merlin')
    .option('-w, --watch', 'Watch for changes and recompile')
    .option('--validate-only', 'Validate without generating code')
    .option('--no-cache', 'Skip the compilation cache and always recompile')
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
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
    .option('-e, --execute', 'Actually execute the deployment (default is dry-run)')
    .option('-r, --ring <ring>', 'Target ring (test, staging, production)')
    .option('--region <region>', 'Target region (eastus, westus, krc)')
    .option('--dir <path>', 'Compiled output directory', '.merlin')
    .option('-o, --output-file <file>', 'Write generated commands to file')
    .option('-c, --concurrency <number>', 'Max parallel resource deployments per level (default: 4)', '4')
    .action(async (argPath, options) => {
        const resourcePath = options.input ?? argPath;
        const outputPath = options.dir;

        try {
            // Auto-compile before deployment
            console.log('🔨 Compiling resources...');
            const compiler = new Compiler();

            const compileResult = await compiler.compile({
                inputPath: resourcePath,
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
                    stdio: 'inherit'
                });
            } else {
                // Use pnpm deploy (dry-run mode)
                console.log('📋 Generating deployment commands (dry-run mode)...\n');
                await execaCommand('pnpm run deploy ' + args.join(' '), {
                    cwd: outputPath,
                    stdio: 'inherit'
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
    .action(async (argPath, options) => {
        const inputPath = options.input ?? argPath;
        // Auto-compile before validation (user preference)
        console.log('🔨 Compiling resources...');
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: inputPath,
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

program.parse();
