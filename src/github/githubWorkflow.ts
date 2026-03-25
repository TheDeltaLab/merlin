import { Resource, ResourceSchema, Command, Render, RenderContext } from '../common/resource.js';

export const GITHUB_WORKFLOW_RESOURCE_TYPE = 'GitHubWorkflow';

export interface GitHubWorkflowConfig extends ResourceSchema {
    /**
     * GitHub repository in "owner/repo" format, e.g. "TheDeltaLab/synapse"
     */
    repo: string;

    /**
     * Workflow file name or ID, e.g. "docker.yml"
     */
    workflow: string;

    /**
     * Branch to run the workflow on (default: "main")
     */
    ref?: string;

    /**
     * Inputs to pass to the workflow_dispatch event (key-value pairs)
     */
    inputs?: Record<string, string>;

    /**
     * Whether to wait for the workflow run to complete before continuing (default: false)
     */
    wait?: boolean;
}

export interface GitHubWorkflowResource extends Resource<GitHubWorkflowConfig> {}

/**
 * GitHubWorkflowRender
 *
 * Triggers a GitHub Actions workflow via `gh workflow run`.
 * Designed for use as a post-deploy step: trigger a Docker build after
 * ACA resources are created so the registry gets an initial image.
 *
 * This is a global resource (no region) — one trigger per ring.
 */
export class GitHubWorkflowRender implements Render {
    isGlobalResource: boolean = true;

    getShortResourceTypeName(): string {
        return 'ghwf';
    }

    async render(resource: Resource, _context?: RenderContext): Promise<Command[]> {
        const config = resource.config as GitHubWorkflowConfig;

        if (!config.repo) {
            throw new Error(`GitHubWorkflow ${resource.name}: 'repo' is required`);
        }
        if (!config.workflow) {
            throw new Error(`GitHubWorkflow ${resource.name}: 'workflow' is required`);
        }

        const ref = config.ref ?? 'main';
        const args: string[] = [
            'workflow', 'run', config.workflow,
            '--repo', config.repo,
            '--ref', ref,
        ];

        // Add --field for each input
        if (config.inputs) {
            for (const [key, value] of Object.entries(config.inputs)) {
                args.push('--field', `${key}=${value}`);
            }
        }

        const commands: Command[] = [{ command: 'gh', args }];

        if (config.wait) {
            // Wait a few seconds for the run to register, then watch it
            commands.push({
                command: 'bash',
                args: [
                    '-c',
                    `sleep 5 && gh run list --repo ${config.repo} --workflow ${config.workflow} --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run watch {} --repo ${config.repo}`,
                ],
            });
        }

        return commands;
    }
}
