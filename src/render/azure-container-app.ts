import type { Command, Render, Resource } from '../types/index.js';

/**
 * Base render class for Azure Container Apps
 */
export class AzureContainerAppRender implements Render {
    async render(resource: Resource): Promise<Command[]> {
        const commands: Command[] = [];

        // Create container app
        commands.push(...(await this.createContainerApp(resource)));

        // Add environment variables if any
        const envVars = this.extractEnvVars(resource);
        if (Object.keys(envVars).length > 0) {
            commands.push(...(await this.addEnv(resource, envVars)));
        }

        return commands;
    }

    async createContainerApp(resource: Resource): Promise<Command[]> {
        const { name, ring, region, parent } = resource;
        const fullName = this.getResourceName(name, ring, region);

        return [
            {
                command: 'az',
                args: [
                    'containerapp',
                    'create',
                    '--name',
                    fullName,
                    '--environment',
                    parent || 'default-cae',
                    '--resource-group',
                    this.getResourceGroup(ring, region),
                    // Add more args based on resource config
                ],
            },
        ];
    }

    async addEnv(
        resource: Resource,
        environments: Record<string, string>,
    ): Promise<Command[]> {
        const { name, ring, region } = resource;
        const fullName = this.getResourceName(name, ring, region);

        const envArgs = Object.entries(environments).flatMap(([key, value]) => [
            '--set-env-vars',
            `${key}=${value}`,
        ]);

        return [
            {
                command: 'az',
                args: [
                    'containerapp',
                    'update',
                    '--name',
                    fullName,
                    '--resource-group',
                    this.getResourceGroup(ring, region),
                    ...envArgs,
                ],
            },
        ];
    }

    private getResourceName(name: string, ring: string, region?: string): string {
        return region ? `${name}-${ring}-${region}` : `${name}-${ring}`;
    }

    private getResourceGroup(ring: string, region?: string): string {
        return region ? `rg-${ring}-${region}` : `rg-${ring}`;
    }

    private extractEnvVars(resource: Resource): Record<string, string> {
        // Extract environment variables from resource config
        // This is a placeholder - actual implementation would parse the config
        return {};
    }
}
