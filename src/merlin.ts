import { Command } from 'commander';

const program = new Command();

program
    .name('merlin')
    .description('CLI tool for Infrastructure as Code deployment and management')
    .version('0.1.0');

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
    .argument('[path]', 'Path to resource configuration file or directory', '.')
    .action((path) => {
        console.log('Validate command - Not yet implemented');
        console.log('Path:', path);
    });

program.parse();
