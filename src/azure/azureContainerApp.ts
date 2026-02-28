import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';

export const AZURE_CONTAINER_APP_TYPE = 'AzureContainerApp';

// refer to: https://learn.microsoft.com/en-us/cli/azure/containerapp?view=azure-cli-latest#az-containerapp-create

// Ingress mode
export type IngressMode = 'external' | 'internal';

// Transport protocol
export type TransportMode = 'auto' | 'http' | 'http2' | 'tcp';

// Revisions mode
export type RevisionMode = 'multiple' | 'single';

// Dapr app protocol
export type DaprProtocol = 'grpc' | 'http';

// Dapr log level
export type DaprLogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface AzureContainerAppConfig extends ResourceSchema {
    // ── Container / image ─────────────────────────────────────────────────────
    image?: string;           // --image
    containerName?: string;   // --container-name
    args?: string[];          // --args (array)
    command?: string[];       // --command (array)
    cpu?: number;             // --cpu  (e.g. 0.5)
    memory?: string;          // --memory (e.g. "1Gi")
    envVars?: string[];       // --env-vars (KEY=VALUE or KEY=secretref:NAME)

    // ── Ingress — CREATE ONLY ─────────────────────────────────────────────────
    ingress?: IngressMode;    // --ingress
    targetPort?: number;      // --target-port
    transport?: TransportMode; // --transport
    exposedPort?: number;     // --exposed-port
    allowInsecure?: boolean;  // --allow-insecure {false, true}

    // ── Scaling ───────────────────────────────────────────────────────────────
    minReplicas?: number;              // --min-replicas
    maxReplicas?: number;              // --max-replicas
    scaleRuleName?: string;            // --scale-rule-name / --srn
    scaleRuleType?: string;            // --scale-rule-type / --srt
    scaleRuleHttpConcurrency?: number; // --scale-rule-http-concurrency / --srhc
    scaleRuleMetadata?: string[];      // --scale-rule-metadata / --srm (KEY=VALUE pairs)
    scaleRuleAuth?: string[];          // --scale-rule-auth / --sra (TRIGGER_PARAM=SECRET_NAME pairs)

    // ── Revision / environment ────────────────────────────────────────────────
    environment?: string;         // --environment  CREATE ONLY
    revisionSuffix?: string;      // --revision-suffix
    revisionsMode?: RevisionMode; // --revisions-mode

    // ── Secrets ───────────────────────────────────────────────────────────────
    secrets?: string[];          // --secrets (NAME=VALUE pairs)
    secretVolumeMount?: string;  // --secret-volume-mount

    // ── Registry ──────────────────────────────────────────────────────────────
    registryServer?: string;    // --registry-server
    registryUsername?: string;  // --registry-username
    registryPassword?: string;  // --registry-password
    registryIdentity?: string;  // --registry-identity

    // ── Managed identity — CREATE ONLY ────────────────────────────────────────
    systemAssigned?: boolean;   // --system-assigned
    userAssigned?: string[];    // --user-assigned (array of resource IDs)

    // ── Workload — CREATE ONLY ────────────────────────────────────────────────
    workloadProfileName?: string; // --workload-profile-name

    // ── Dapr ──────────────────────────────────────────────────────────────────
    enableDapr?: boolean;              // --enable-dapr {false, true}
    daprAppId?: string;                // --dapr-app-id
    daprAppPort?: number;              // --dapr-app-port
    daprAppProtocol?: DaprProtocol;    // --dapr-app-protocol {grpc, http}
    daprHttpMaxRequestSize?: number;   // --dapr-http-max-request-size / --dhmrs
    daprHttpReadBufferSize?: number;   // --dapr-http-read-buffer-size / --dhrbs
    daprLogLevel?: DaprLogLevel;       // --dapr-log-level {debug, error, info, warn}
    daprEnableApiLogging?: boolean;    // --dal / --dapr-enable-api-logging

    // ── Misc ──────────────────────────────────────────────────────────────────
    terminationGracePeriod?: number;   // --termination-grace-period / --tgp
    /**
     * --no-wait is a presence-only flag (no value).
     * When true, '--no-wait' is appended without a following 'true'/'false' value.
     */
    noWait?: boolean;
    tags?: Record<string, string>;     // --tags
}

export interface AzureContainerAppResource extends AzureResource<AzureContainerAppConfig> {}

// Valid CPU → memory combinations for Consumption Container Apps.
// Source: https://learn.microsoft.com/en-us/azure/container-apps/containers#allocations
const VALID_CPU_MEMORY_COMBINATIONS: ReadonlyMap<number, string> = new Map([
    [0.25, '0.5Gi'],
    [0.5,  '1.0Gi'],
    [0.75, '1.5Gi'],
    [1.0,  '2.0Gi'],
    [1.25, '2.5Gi'],
    [1.5,  '3.0Gi'],
    [1.75, '3.5Gi'],
    [2.0,  '4.0Gi'],
    [2.25, '4.5Gi'],
    [2.5,  '5.0Gi'],
    [2.75, '5.5Gi'],
    [3.0,  '6.0Gi'],
    [3.25, '6.5Gi'],
    [3.5,  '7.0Gi'],
    [3.75, '7.5Gi'],
    [4.0,  '8.0Gi'],
]);

export class AzureContainerAppRender extends AzureResourceRender {

    /** Container app names support hyphens */
    supportConnectorInResourceName: boolean = true;

    override getShortResourceTypeName(): string {
        return 'aca';
    }

    async renderImpl(resource: Resource): Promise<Command[]> {
        if (!AzureContainerAppRender.isAzureContainerAppResource(resource)) {
            throw new Error(`Resource ${resource.name} is not an Azure Container App resource`);
        }

        const { cpu, memory } = resource.config;
        if (cpu !== undefined || memory !== undefined) {
            if (cpu === undefined || memory === undefined) {
                throw new Error(
                    `Resource ${resource.name}: cpu and memory must both be specified together.`
                );
            }
            const expectedMemory = VALID_CPU_MEMORY_COMBINATIONS.get(cpu);
            if (expectedMemory === undefined) {
                const validCpus = [...VALID_CPU_MEMORY_COMBINATIONS.keys()].join(', ');
                throw new Error(
                    `Resource ${resource.name}: invalid cpu value ${cpu}. Valid cpu values are: ${validCpus}.`
                );
            }
            // Normalise memory string for comparison (e.g. "1Gi" === "1.0Gi")
            const normalisedMemory = parseFloat(memory).toFixed(1) + 'Gi';
            if (normalisedMemory !== expectedMemory) {
                throw new Error(
                    `Resource ${resource.name}: invalid cpu/memory combination (cpu: ${cpu}, memory: ${memory}). ` +
                    `For cpu ${cpu}, memory must be ${expectedMemory}.`
                );
            }
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource);
        ret.push(...rgCommands);

        // Check if container app already exists
        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureContainerAppResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureContainerAppResource));
        }

        return ret;
    }

    private static isAzureContainerAppResource(resource: Resource): resource is AzureContainerAppResource {
        return resource.type === AZURE_CONTAINER_APP_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<AzureContainerAppConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = execSync(
                `az containerapp show -g ${resourceGroup} -n ${resourceName} 2>/dev/null`,
                { encoding: 'utf-8' }
            );

            const d = JSON.parse(result);

            // Convenience accessors
            const container = d.template?.containers?.[0];
            const ingress = d.configuration?.ingress;
            const dapr = d.configuration?.dapr;
            const registry = d.configuration?.registries?.[0];
            const scale = d.template?.scale;
            const identity = d.identity;

            const config: AzureContainerAppConfig = {
                // Container
                image: container?.image,
                containerName: container?.name,
                args: container?.args,
                command: container?.command,
                cpu: container?.resources?.cpu !== undefined
                    ? parseFloat(String(container.resources.cpu))
                    : undefined,
                memory: container?.resources?.memory,
                envVars: Array.isArray(container?.env)
                    ? container.env.map((e: { name: string; value?: string; secretRef?: string }) =>
                        e.secretRef ? `${e.name}=secretref:${e.secretRef}` : `${e.name}=${e.value ?? ''}`)
                    : undefined,

                // Ingress (create-only, kept for state detection)
                ingress: ingress !== undefined
                    ? (ingress.external ? 'external' : 'internal')
                    : undefined,
                targetPort: ingress?.targetPort,
                transport: ingress?.transport,
                exposedPort: ingress?.exposedPort,
                allowInsecure: ingress?.allowInsecure,

                // Scaling
                minReplicas: scale?.minReplicas,
                maxReplicas: scale?.maxReplicas,

                // Revision
                revisionsMode: d.configuration?.revisionMode
                    ? (d.configuration.revisionMode.toLowerCase() as RevisionMode)
                    : undefined,

                // Registry
                registryServer: registry?.server,
                registryUsername: registry?.username,
                registryIdentity: registry?.identity,
                // registryPassword is write-only — not returned by show

                // Identity (create-only, kept for state detection)
                systemAssigned: identity?.type
                    ? identity.type.includes('SystemAssigned')
                    : undefined,
                userAssigned: identity?.userAssignedIdentities
                    ? Object.keys(identity.userAssignedIdentities)
                    : undefined,

                // Workload (create-only)
                workloadProfileName: d.properties?.workloadProfileName,

                // Dapr
                enableDapr: dapr?.enabled,
                daprAppId: dapr?.appId,
                daprAppPort: dapr?.appPort,
                daprAppProtocol: dapr?.appProtocol,
                daprHttpMaxRequestSize: dapr?.httpMaxRequestSize,
                daprHttpReadBufferSize: dapr?.httpReadBufferSize,
                daprLogLevel: dapr?.logLevel,
                daprEnableApiLogging: dapr?.enableApiLogging,

                // Misc
                terminationGracePeriod: d.template?.terminationGracePeriodSeconds,
                tags: d.tags,

                // secrets: intentionally omitted — values are redacted in show output
            };

            // Remove undefined values
            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as AzureContainerAppConfig;

        } catch (error: any) {
            if (error.status === 3 || error.status === 1) {
                return undefined;
            }

            const errorMessage = error.message || String(error);
            const stderr = error.stderr?.toString() || '';
            const combinedError = errorMessage + ' ' + stderr;

            if (combinedError.includes('ResourceNotFound') ||
                combinedError.includes('ResourceGroupNotFound') ||
                combinedError.includes('was not found') ||
                combinedError.includes('could not be found')) {
                return undefined;
            }

            throw new Error(
                `Failed to get deployed properties for container app ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    /**
     * Simple key-value params supported on BOTH create and update
     */
    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'image': '--image',
        'containerName': '--container-name',
        'cpu': '--cpu',
        'memory': '--memory',
        'minReplicas': '--min-replicas',
        'maxReplicas': '--max-replicas',
        'revisionSuffix': '--revision-suffix',
        'revisionsMode': '--revisions-mode',
        'scaleRuleName': '--scale-rule-name',
        'scaleRuleType': '--scale-rule-type',
        'scaleRuleHttpConcurrency': '--scale-rule-http-concurrency',
        'secretVolumeMount': '--secret-volume-mount',
        'registryServer': '--registry-server',
        'registryUsername': '--registry-username',
        'registryPassword': '--registry-password',
        'registryIdentity': '--registry-identity',
        'daprAppId': '--dapr-app-id',
        'daprAppPort': '--dapr-app-port',
        'daprAppProtocol': '--dapr-app-protocol',
        'daprHttpMaxRequestSize': '--dapr-http-max-request-size',
        'daprHttpReadBufferSize': '--dapr-http-read-buffer-size',
        'daprLogLevel': '--dapr-log-level',
        'terminationGracePeriod': '--termination-grace-period',
    };

    /**
     * Simple key-value params supported on CREATE only
     */
    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'environment': '--environment',
        'workloadProfileName': '--workload-profile-name',
        'ingress': '--ingress',
        'targetPort': '--target-port',
        'transport': '--transport',
        'exposedPort': '--exposed-port',
    };

    /**
     * Boolean flags (emit --flag true/false) supported on BOTH create and update
     */
    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableDapr': '--enable-dapr',
        'daprEnableApiLogging': '--dapr-enable-api-logging',
    };

    /**
     * Boolean flags (emit --flag true/false) supported on CREATE only
     */
    private static readonly CREATE_ONLY_BOOLEAN_FLAG_MAP: Record<string, string> = {
        'allowInsecure': '--allow-insecure',
        // Note: --system-assigned is a presence-only flag (no value) — handled inline in renderCreate()
    };

    /**
     * Array params (space-joined) supported on BOTH create and update
     */
    private static readonly ARRAY_PARAM_MAP: Record<string, string> = {
        'envVars': '--env-vars',
        'secrets': '--secrets',
        'scaleRuleMetadata': '--scale-rule-metadata',
        'scaleRuleAuth': '--scale-rule-auth',
    };

    /**
     * Array params (space-joined) supported on CREATE only
     */
    private static readonly CREATE_ONLY_ARRAY_PARAM_MAP: Record<string, string> = {
        'args': '--args',
        'command': '--command',
        'userAssigned': '--user-assigned',
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: AzureContainerAppResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('containerapp', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        this.addSimpleParams(args, config, AzureContainerAppRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzureContainerAppRender.CREATE_ONLY_SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppRender.BOOLEAN_FLAG_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppRender.CREATE_ONLY_BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureContainerAppRender.ARRAY_PARAM_MAP);
        this.addArrayParams(args, config, AzureContainerAppRender.CREATE_ONLY_ARRAY_PARAM_MAP);

        // --no-wait is a presence-only flag (no value argument)
        if (config.noWait === true) {
            args.push('--no-wait');
        }

        // --system-assigned is a presence-only flag (no value argument)
        if (config.systemAssigned === true) {
            args.push('--system-assigned');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }

    renderUpdate(resource: AzureContainerAppResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('containerapp', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // CREATE_ONLY_* maps are intentionally excluded here
        this.addSimpleParams(args, config, AzureContainerAppRender.SIMPLE_PARAM_MAP);
        this.addBooleanFlags(args, config, AzureContainerAppRender.BOOLEAN_FLAG_MAP);
        this.addArrayParams(args, config, AzureContainerAppRender.ARRAY_PARAM_MAP);

        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        return [{ command: 'az', args }];
    }
}
