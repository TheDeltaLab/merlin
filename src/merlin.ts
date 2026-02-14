import { Command } from 'commander';
import { Compiler } from './common/compiler.js';

const program = new Command();

program
    .name('merlin')
    .description('CLI tool for Infrastructure as Code deployment and management')
    .version('0.1.0');

program
    .command('compile')
    .description('Compile YAML resource definitions to TypeScript')
    .argument('[path]', 'Path to YAML file or directory', './resources')
    .option('-o, --output <path>', 'Output directory', '.merlin')
    .option('-w, --watch', 'Watch for changes and recompile')
    .option('--validate-only', 'Validate without generating code')
    .action(async (path, options) => {
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: path,
                outputPath: options.output,
                watch: options.watch,
                validate: options.validateOnly
            });

            if (result.success) {
                console.log(`✅ Compiled ${result.generatedFiles.length} files`);
                result.generatedFiles.forEach(f => console.log(`   - ${f}`));

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
                    inputPath: path,
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
    .option('-e, --execute', 'Actually execute the deployment (default is dry-run)')
    .option('-r, --ring <ring>', 'Target ring (test, staging, production)')
    .option('--region <region>', 'Target region (eastus, westus, krc)')
    .action((options) => {
        console.log('Deploy command - Not yet implemented');
        console.log('Options:', options);
        if (!options.execute) {
            console.log('Running in dry-run mode (use --execute to actually deploy)');
        }
    });

program
    .command('validate')
    .description('Validate resource configuration files')
    .argument('[path]', 'Path to resource configuration file or directory', './resources')
    .action(async (path) => {
        // Auto-compile before validation (user preference)
        console.log('🔨 Compiling resources...');
        const compiler = new Compiler();

        try {
            const result = await compiler.compile({
                inputPath: path,
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
