import { Command } from 'commander';

const program = new Command();

program
    .name('merlin')
    .description('CLI tool for Infrastructure as Code deployment and management')
    .version('0.1.0');

program
    .command('deploy')
    .description('Deploy infrastructure resources')
    .option('-d, --dry-run', 'Show what would be deployed without actually deploying')
    .option('-r, --ring <ring>', 'Target ring (test, staging, production)')
    .option('--region <region>', 'Target region (eastus, westus, krc)')
    .action((options) => {
        console.log('Deploy command - Not yet implemented');
        console.log('Options:', options);
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
