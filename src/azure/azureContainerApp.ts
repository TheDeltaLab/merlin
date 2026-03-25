import { AzureResource } from './resource.js';
import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from './render.js';
import { execSync } from 'child_process';
import { dump as yamlDump } from 'js-yaml';

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

// ── Health probe types ────────────────────────────────────────────────────────

export type ProbeType = 'Liveness' | 'Readiness' | 'Startup';
export type ProbeScheme = 'HTTP' | 'HTTPS';

export interface HttpProbeConfig {
    path: string;
    port: number;
    scheme?: ProbeScheme;
    httpHeaders?: Array<{ name: string; value: string }>;
}

export interface TcpProbeConfig {
    port: number;
}

export interface ContainerProbe {
    type: ProbeType;
    /** Specify exactly one of httpGet or tcpSocket */
    httpGet?: HttpProbeConfig;
    tcpSocket?: TcpProbeConfig;
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    failureThreshold?: number;
    successThreshold?: number;
}


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

    // ── DNS Zone 绑定 ──────────────────────────────────────────────────────────
    /**
     * 配置后将在容器应用部署完成后绑定自定义 DNS 主机名。
     * 不会传入 az containerapp create/update 命令。
     *
     * 触发以下部署步骤（通过 envCapture 机制在执行时动态获取参数）：
     * 0a. 查询 DNS Zone 所在 Resource Group
     * 0b. 查询 Container Environment 的 ARM resource ID
     * 0c. 从 ARM ID 提取 Environment 名称（最后一段）
     *  1. 获取容器应用默认域名（FQDN）
     *  2. 在 DNS Zone 中创建 CNAME 记录
     *  3. 获取自定义域名验证 ID
     *  4. 在 DNS Zone 中创建 TXT 验证记录（asuid.<subDomain>）
     *  5. 将自定义域名绑定到容器应用
     */
    bindDnsZone?: {
        /** Azure DNS Zone 名称（例如 "example.com"） */
        dnsZone: string;
        /** 子域名前缀（例如 "myapp" 对应 "myapp.example.com"） */
        subDomain: string;
    } | Array<{
        /** Azure DNS Zone 名称（例如 "example.com"） */
        dnsZone: string;
        /** 子域名前缀（例如 "myapp" 对应 "myapp.example.com"） */
        subDomain: string;
    }>;

    // ── Health probes ──────────────────────────────────────────────────────────
    /**
     * Container health probe configuration.
     * When set, renderCreate/renderUpdate will use --yaml mode because
     * az containerapp create/update does not support probes via CLI flags.
     * Supports Liveness, Readiness, and Startup probe types with either
     * httpGet or tcpSocket checks.
     */
    probes?: ContainerProbe[];

    // ── EasyAuth (Built-in Authentication) ────────────────────────────────────
    /**
     * Azure Container Apps built-in authentication (EasyAuth) configuration.
     *
     * Merlin will automatically:
     *   1. Generate (or rotate) a client secret on the AD App via
     *      `az ad app credential reset --append`
     *   2. Store the secret value in an ACA secret named
     *      `microsoft-provider-authentication-secret`
     *   3. Update the AD App's webRedirectUris with the ACA callback URL
     *   4. Enable EasyAuth on the Container App
     *   5. Configure the Microsoft (AAD) identity provider
     *
     * The clientId is typically a ${ AzureADApp.<name>.clientId } expression
     * resolved at deploy time.
     */
    auth?: {
        /** Azure AD Application (client) ID. */
        clientId: string;
        /**
         * OpenID Connect issuer URI.
         * Default: https://sts.windows.net/<tenantId>/v2.0
         */
        issuer?: string;
        /**
         * Action for unauthenticated clients.
         * Default: RedirectToLoginPage
         */
        unauthenticatedClientAction?: 'AllowAnonymous' | 'RedirectToLoginPage' | 'Return401' | 'Return403';
    };
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
        // ACA names must be ≤ 32 chars; omitting the type suffix keeps names short.
        // The resource is already unambiguously an ACA by context.
        return '';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
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
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        // Check if container app already exists
        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as AzureContainerAppResource));
        } else {
            ret.push(...this.renderUpdate(resource as AzureContainerAppResource));
        }

        // Post-deployment: bind custom DNS zone if configured
        ret.push(...this.renderBindDnsZone(resource as AzureContainerAppResource));

        // Post-deployment: configure EasyAuth if configured
        ret.push(...this.renderAuth(resource as AzureContainerAppResource));

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

                // Probes
                probes: Array.isArray(container?.probes)
                    ? container.probes.map((p: Record<string, unknown>) => {
                        const probe: ContainerProbe = { type: p.type as ProbeType };
                        const httpGet = p.httpGet as Record<string, unknown> | undefined;
                        const tcpSocket = p.tcpSocket as Record<string, unknown> | undefined;
                        if (httpGet) {
                            probe.httpGet = {
                                path: httpGet.path as string,
                                port: httpGet.port as number,
                                scheme: httpGet.scheme as ProbeScheme | undefined,
                            };
                        } else if (tcpSocket) {
                            probe.tcpSocket = { port: tcpSocket.port as number };
                        }
                        if (p.initialDelaySeconds !== undefined) probe.initialDelaySeconds = p.initialDelaySeconds as number;
                        if (p.periodSeconds !== undefined) probe.periodSeconds = p.periodSeconds as number;
                        if (p.timeoutSeconds !== undefined) probe.timeoutSeconds = p.timeoutSeconds as number;
                        if (p.failureThreshold !== undefined) probe.failureThreshold = p.failureThreshold as number;
                        if (p.successThreshold !== undefined) probe.successThreshold = p.successThreshold as number;
                        return probe;
                    })
                    : undefined,
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
        'scaleRuleName': '--scale-rule-name',
        'scaleRuleType': '--scale-rule-type',
        'scaleRuleHttpConcurrency': '--scale-rule-http-concurrency',
        'secretVolumeMount': '--secret-volume-mount',
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
        // Registry and revision mode are not supported by `az containerapp update`
        'revisionsMode': '--revisions-mode',
        'registryServer': '--registry-server',
        'registryUsername': '--registry-username',
        'registryPassword': '--registry-password',
        'registryIdentity': '--registry-identity',
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
        'secrets': '--secrets',
        'scaleRuleMetadata': '--scale-rule-metadata',
        'scaleRuleAuth': '--scale-rule-auth',
        'envVars': '--env-vars',
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
        const config = resource.config;

        const args: string[] = [];

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

        const createCmd: Command = { command: 'az', args };

        // When probes are configured, az containerapp create does not support probes via CLI flags.
        // az containerapp create --yaml also cannot set probes reliably (managedEnvironmentId lookup
        // issues). The solution: create with CLI flags first, then immediately update via --yaml to
        // apply the probes. This is always safe because the update runs right after create.
        if (config.probes && config.probes.length > 0) {
            return [createCmd, ...this.renderUpdateViaYaml(resource)];
        }

        return [createCmd];
    }

    /**
     * Generates the command sequence for binding a custom DNS zone to a container app.
     * Returns an empty array if bindDnsZone is not configured.
     *
     * All dynamic values (DNS Zone RG, Environment name, FQDN, verification ID) are
     * captured at deploy time via envCapture — no execSync calls during render.
     *
     * Note: DNS record commands are not fully idempotent:
     *   cname set-record overwrites any existing CNAME value;
     *   txt add-record may create duplicate TXT records on repeated runs.
     */
    private renderBindDnsZone(resource: AzureContainerAppResource): Command[] {
        const { bindDnsZone } = resource.config;
        if (!bindDnsZone) return [];

        // Support both single object and array of DNS zone bindings
        const entries = Array.isArray(bindDnsZone) ? bindDnsZone : [bindDnsZone];
        const allCommands: Command[] = [];
        for (const { dnsZone, subDomain } of entries) {
        const resourceName  = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        // Slug: uppercase, non-alphanumeric → underscore (mirrors paramResolver.ts toVarName)
        const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        // Include dnsZone in slug so multiple bindDnsZone entries get distinct variable names
        const appSlug         = `${slug(resourceName)}_${slug(dnsZone)}`;
        const dnsZoneRgVar    = `MERLIN_${appSlug}_DNS_ZONE_RG`;
        const envArmIdVar     = `MERLIN_${appSlug}_ENV_ARM_ID`;
        const envNameVar      = `MERLIN_${appSlug}_ENV_NAME`;
        const fqdnVar         = `MERLIN_${appSlug}_FQDN`;
        const verificationVar = `MERLIN_${appSlug}_VERIFICATION_ID`;

        const commands: Command[] = [];

        // ── Step 0a: Look up the DNS Zone resource group ─────────────────────
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'zone', 'list',
                '--query', `[?name=='${dnsZone}'].resourceGroup`,
                '--output', 'tsv',
            ],
            envCapture: dnsZoneRgVar,
        });

        // ── Step 0b: Look up the Container Environment ARM resource ID ────────
        commands.push({
            command: 'az',
            args: [
                'containerapp', 'show',
                '--name',           resourceName,
                '--resource-group', resourceGroup,
                '--query',          'properties.managedEnvironmentId',
                '--output',         'tsv',
            ],
            envCapture: envArmIdVar,
        });

        // ── Step 0c: Extract environment name from ARM ID (last path segment) ─
        // ARM ID format: .../providers/Microsoft.App/managedEnvironments/<env-name>
        // Merlin only supports simple $VARNAME substitution, not bash parameter expansion,
        // so we use a separate bash command to extract the last segment.
        commands.push({
            command: 'bash',
            args: ['-c', `echo $${envArmIdVar} | sed 's|.*/||'`],
            envCapture: envNameVar,
        });

        // ── Step 1: Register the hostname on the container app (no certificate yet) ─
        // Azure requires the hostname to be added to the container app before a managed
        // certificate can be requested. This step does not need any DNS records.
        // Use bash to swallow the "already exists" error — idempotent on re-runs.
        commands.push({
            command: 'bash',
            args: [
                '-c',
                `az containerapp hostname add --hostname ${subDomain}.${dnsZone} --name ${resourceName} --resource-group ${resourceGroup} || true`,
            ],
        });

        // ── Step 2: Capture the container app's default ingress FQDN ─────────
        commands.push({
            command: 'az',
            args: [
                'containerapp', 'show',
                '--name',           resourceName,
                '--resource-group', resourceGroup,
                '--query',          'properties.configuration.ingress.fqdn',
                '--output',         'tsv',
            ],
            envCapture: fqdnVar,
        });

        // ── Step 3: Create CNAME record in the DNS zone ───────────────────────
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'record-set', 'cname', 'set-record',
                '--resource-group',  `$${dnsZoneRgVar}`,
                '--zone-name',       dnsZone,
                '--record-set-name', subDomain,
                '--cname',           `$${fqdnVar}`,
            ],
        });

        // ── Step 4: Capture the custom domain verification ID ─────────────────
        commands.push({
            command: 'az',
            args: [
                'containerapp', 'show',
                '--name',           resourceName,
                '--resource-group', resourceGroup,
                '--query',          'properties.customDomainVerificationId',
                '--output',         'tsv',
            ],
            envCapture: verificationVar,
        });

        // ── Step 5: Create TXT verification record (asuid.<subDomain>) ────────
        commands.push({
            command: 'az',
            args: [
                'network', 'dns', 'record-set', 'txt', 'add-record',
                '--resource-group',  `$${dnsZoneRgVar}`,
                '--zone-name',       dnsZone,
                '--record-set-name', `asuid.${subDomain}`,
                '--value',           `$${verificationVar}`,
            ],
        });

        // ── Wait for DNS propagation ──────────────────────────────────────────
        // After Azure DNS returns "Succeeded", authoritative name servers need
        // a few seconds to sync. Wait before running hostname bind validation.
        commands.push({
            command: 'bash',
            args: ['-c', 'sleep 30'],
        });

        // ── Step 6: Bind the hostname and request a managed certificate ────────
        // Use || true to make this idempotent — if the hostname is already bound
        // (certificate already issued), Azure returns an error we can safely ignore.
        commands.push({
            command: 'bash',
            args: [
                '-c',
                `az containerapp hostname bind --hostname ${subDomain}.${dnsZone} --resource-group ${resourceGroup} --name ${resourceName} --environment $${envNameVar} --validation-method CNAME || true`,
            ],
        });

        allCommands.push(...commands);
        } // end for each bindDnsZone entry
        return allCommands;
    }

    renderUpdate(resource: AzureContainerAppResource): Command[] {
        const config = resource.config;

        // When probes are configured, use --yaml mode (CLI doesn't support probes directly)
        if (config.probes && config.probes.length > 0) {
            return this.renderUpdateViaYaml(resource);
        }

        const args: string[] = [];

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

    // ── EasyAuth render ───────────────────────────────────────────────────────

    /**
     * Renders EasyAuth (built-in authentication) commands.
     *
     * Steps emitted:
     *   1. Generate (or rotate) a client secret on the AD App and capture the value
     *   2. Store the secret value as an ACA secret
     *   3. Update the AD App's webRedirectUris with the ACA callback URL
     *   4. az containerapp auth update  — enable auth + set unauthenticated action
     *   5. az containerapp auth microsoft update  — configure AAD identity provider
     *
     * All dynamic values (FQDN, client secret) are resolved at deploy time via
     * envCapture, so this is safe to re-run on both create and update paths.
     */
    private renderAuth(resource: AzureContainerAppResource): Command[] {
        const { auth } = resource.config;
        if (!auth) return [];

        const resourceName  = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);
        const action = auth.unauthenticatedClientAction ?? 'RedirectToLoginPage';
        const secretName = 'microsoft-provider-authentication-secret';

        const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const appSlug      = slug(resourceName);
        const fqdnVar      = `MERLIN_${appSlug}_AUTH_FQDN`;
        const secretValVar = `MERLIN_${appSlug}_AUTH_SECRET`;

        return [
            // Step 1: generate (append) a new client secret on the AD App
            {
                command: 'az',
                args: [
                    'ad', 'app', 'credential', 'reset',
                    '--id',          auth.clientId,
                    '--append',
                    '--display-name', `merlin-easyauth-${resourceName}`,
                    '--query',        'password',
                    '-o',             'tsv',
                ],
                envCapture: secretValVar,
            },
            // Step 2: store the secret value in the ACA
            {
                command: 'az',
                args: [
                    'containerapp', 'secret', 'set',
                    '--name',           resourceName,
                    '--resource-group', resourceGroup,
                    '--secrets',        `${secretName}=$${secretValVar}`,
                ],
            },
            // Step 3: get the ACA FQDN for the redirect URI
            {
                command: 'az',
                args: [
                    'containerapp', 'show',
                    '--name',           resourceName,
                    '--resource-group', resourceGroup,
                    '--query',          'properties.configuration.ingress.fqdn',
                    '-o',               'tsv',
                ],
                envCapture: fqdnVar,
            },
            // Step 4: update the AD App's webRedirectUris
            {
                command: 'az',
                args: [
                    'ad', 'app', 'update',
                    '--id',               auth.clientId,
                    '--web-redirect-uris', `https://$${fqdnVar}/.auth/login/aad/callback`,
                ],
            },
            // Step 5: enable auth platform + set unauthenticated action
            {
                command: 'az',
                args: [
                    'containerapp', 'auth', 'update',
                    '--name',           resourceName,
                    '--resource-group', resourceGroup,
                    '--enabled',        'true',
                    '--action',         action,
                ],
            },
            // Step 6: configure Microsoft (AAD) identity provider
            {
                command: 'az',
                args: [
                    'containerapp', 'auth', 'microsoft', 'update',
                    '--name',               resourceName,
                    '--resource-group',     resourceGroup,
                    '--client-id',          auth.clientId,
                    '--client-secret-name', secretName,
                    ...(auth.issuer ? ['--issuer', auth.issuer] : []),
                ],
            },
        ];
    }

    // ── YAML-based render (for probe support) ────────────────────────────────

    /**
     * Renders an `az containerapp update --yaml` command.
     * Used when probes are configured.
     */
    private renderUpdateViaYaml(resource: AzureContainerAppResource): Command[] {
        const fileContent = this.buildContainerAppYaml(resource);
        return [{
            command: 'az',
            args: [
                'containerapp', 'update',
                '--name',           this.getResourceName(resource),
                '--resource-group', this.getResourceGroupName(resource),
                '--yaml',           '__MERLIN_YAML_FILE__',
                ...(resource.config.noWait ? ['--no-wait'] : []),
            ],
            fileContent,
        }];
    }

    /**
     * Serializes the resource config to the YAML format expected by
     * `az containerapp update --yaml`.
     *
     * Only includes fields relevant to update: container template (image, resources,
     * env vars, probes) and scale. Ingress, registry, and identity are create-only
     * and handled via CLI flags in renderCreate().
     */
    private buildContainerAppYaml(resource: AzureContainerAppResource): string {
        const config = resource.config;
        const resourceName = this.getResourceName(resource);

        // ── containers[0] ──
        const container: Record<string, unknown> = {
            name: config.containerName ?? resourceName,
        };

        if (config.image !== undefined) container.image = config.image;

        if (config.cpu !== undefined) {
            container.resources = { cpu: config.cpu, memory: config.memory };
        }

        if (config.envVars && config.envVars.length > 0) {
            container.env = config.envVars.map((ev: string) => {
                const sepIdx = ev.indexOf('=');
                const name = ev.slice(0, sepIdx);
                const rawValue = ev.slice(sepIdx + 1);
                if (rawValue.startsWith('secretref:')) {
                    return { name, secretRef: rawValue.slice('secretref:'.length) };
                }
                return { name, value: rawValue };
            });
        }

        if (config.probes && config.probes.length > 0) {
            container.probes = config.probes.map(p => this.buildProbeYaml(p));
        }

        // ── template ──
        const template: Record<string, unknown> = { containers: [container] };

        if (config.minReplicas !== undefined || config.maxReplicas !== undefined) {
            template.scale = {
                ...(config.minReplicas !== undefined && { minReplicas: config.minReplicas }),
                ...(config.maxReplicas !== undefined && { maxReplicas: config.maxReplicas }),
            };
        }

        if (config.terminationGracePeriod !== undefined) {
            template.terminationGracePeriodSeconds = config.terminationGracePeriod;
        }

        // ── configuration (revision mode only for update) ──
        const configuration: Record<string, unknown> = {};

        if (config.revisionsMode) {
            configuration.activeRevisionsMode =
                config.revisionsMode === 'single' ? 'Single' : 'Multiple';
        }

        if (config.secrets && config.secrets.length > 0) {
            configuration.secrets = config.secrets.map((s: string) => {
                const eqIdx = s.indexOf('=');
                return { name: s.slice(0, eqIdx), value: s.slice(eqIdx + 1) };
            });
        }

        if (config.enableDapr !== undefined) {
            configuration.dapr = {
                enabled: config.enableDapr,
                ...(config.daprAppId && { appId: config.daprAppId }),
                ...(config.daprAppPort !== undefined && { appPort: config.daprAppPort }),
                ...(config.daprAppProtocol && { appProtocol: config.daprAppProtocol }),
            };
        }

        // ── top-level document ──
        const properties: Record<string, unknown> = {
            ...(Object.keys(configuration).length > 0 && { configuration }),
            template,
        };

        const doc: Record<string, unknown> = { properties };

        if (config.tags && Object.keys(config.tags).length > 0) {
            doc.tags = config.tags;
        }

        return yamlDump(doc, { lineWidth: -1, noRefs: true });
    }

    /** Serializes a single ContainerProbe to the Azure ARM YAML format. */
    private buildProbeYaml(probe: ContainerProbe): Record<string, unknown> {
        const result: Record<string, unknown> = { type: probe.type };

        if (probe.httpGet) {
            result.httpGet = {
                path: probe.httpGet.path,
                port: probe.httpGet.port,
                scheme: probe.httpGet.scheme ?? 'HTTP',
                ...(probe.httpGet.httpHeaders && { httpHeaders: probe.httpGet.httpHeaders }),
            };
        } else if (probe.tcpSocket) {
            result.tcpSocket = { port: probe.tcpSocket.port };
        }

        if (probe.initialDelaySeconds !== undefined) result.initialDelaySeconds = probe.initialDelaySeconds;
        if (probe.periodSeconds       !== undefined) result.periodSeconds       = probe.periodSeconds;
        if (probe.timeoutSeconds      !== undefined) result.timeoutSeconds      = probe.timeoutSeconds;
        if (probe.failureThreshold    !== undefined) result.failureThreshold    = probe.failureThreshold;
        if (probe.successThreshold    !== undefined) result.successThreshold    = probe.successThreshold;

        return result;
    }

}
