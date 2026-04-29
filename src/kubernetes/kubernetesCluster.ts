import { Resource, ResourceSchema, Command, RenderContext } from '../common/resource.js';
import { AzureResourceRender } from '../azure/render.js';
import { isResourceNotFoundError, execAsync } from '../common/constants.js';

export const KUBERNETES_CLUSTER_TYPE = 'KubernetesCluster';
export const AZURE_AKS_TYPE = 'AzureAKSCluster';

// refer to: https://learn.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest#az-aks-create

export interface KubernetesClusterConfig extends ResourceSchema {
    // ── Node pool ────────────────────────────────────────────────────────────
    nodeCount?: number;                     // --node-count
    minCount?: number;                      // --min-count (requires enableAutoScaling)
    maxCount?: number;                      // --max-count (requires enableAutoScaling)
    enableAutoScaling?: boolean;            // --enable-cluster-autoscaler
    nodeVmSize?: string;                    // --node-vm-size (e.g. Standard_DS2_v2)
    nodePoolName?: string;                  // --nodepool-name

    // ── Kubernetes version ────────────────────────────────────────────────────
    kubernetesVersion?: string;             // --kubernetes-version (e.g. 1.29.2)

    // ── Networking ────────────────────────────────────────────────────────────
    networkPlugin?: string;                 // --network-plugin (azure | kubenet | none)
    networkPolicy?: string;                 // --network-policy (azure | calico | cilium | none)
    vnetSubnetId?: string;                  // --vnet-subnet-id
    serviceCidr?: string;                   // --service-cidr
    dnsServiceIp?: string;                  // --dns-service-ip
    loadBalancerSku?: string;               // --load-balancer-sku (basic | standard)

    // ── Identity ──────────────────────────────────────────────────────────────
    enableManagedIdentity?: boolean;        // --enable-managed-identity
    assignIdentity?: string;               // --assign-identity (user-assigned identity resource ID)

    // ── Add-ons ───────────────────────────────────────────────────────────────
    enableAzureMonitor?: boolean;           // --enable-azure-monitor-metrics
    enableHttpApplicationRouting?: boolean; // (legacy, prefer NGINX ingress)

    // ── Misc ──────────────────────────────────────────────────────────────────
    location?: string;                      // --location
    noWait?: boolean;                       // --no-wait
    tags?: Record<string, string>;          // --tags

    // ── OIDC / Workload Identity / CSI Secret Store ─────────────────────────
    enableOidcIssuer?: boolean;             // --enable-oidc-issuer
    enableWorkloadIdentity?: boolean;       // --enable-workload-identity
    enableCsiSecretProvider?: boolean;      // --enable-addons azure-keyvault-secrets-provider
    enableSecretRotation?: boolean;         // --enable-secret-rotation (CSI addon)

    // ── ACR integration ─────────────────────────────────────────────────────
    /**
     * ACR resource name or ID to attach for image pulling.
     * Runs `az aks update --attach-acr <value>` after create/update.
     * This grants AKS's kubelet managed identity the AcrPull role on the ACR.
     */
    attachAcr?: string;
}

export interface KubernetesClusterResource extends Resource<KubernetesClusterConfig> {}

/**
 * Render for Azure Kubernetes Service (AKS) clusters.
 *
 * On create:
 *   1. Ensure resource group
 *   2. az aks create ...
 *   3. az aks get-credentials (merge kubeconfig)
 *   4. kubectl create namespace <ns> for each configured namespace
 *
 * On update:
 *   1. az aks update ...
 *   2. az aks get-credentials (refresh credentials)
 */
export class AzureAKSRender extends AzureResourceRender {
    supportConnectorInResourceName = true;

    override getShortResourceTypeName(): string {
        return 'aks';
    }

    async renderImpl(resource: Resource, context?: RenderContext): Promise<Command[]> {
        if (!AzureAKSRender.isKubernetesClusterResource(resource)) {
            throw new Error(`Resource ${resource.name} is not a KubernetesCluster resource`);
        }

        const ret: Command[] = [];

        // Ensure resource group exists first
        const rgCommands = await this.ensureResourceGroupCommands(resource, context);
        ret.push(...rgCommands);

        const deployedProps = await this.getDeployedProps(resource);

        if (!deployedProps) {
            ret.push(...this.renderCreate(resource as KubernetesClusterResource));
        } else {
            ret.push(...this.renderUpdate(resource as KubernetesClusterResource));
        }

        // Always refresh kubeconfig after create/update
        ret.push(...this.renderGetCredentials(resource as KubernetesClusterResource));

        // Enable secret rotation for CSI Secret Store Provider
        const config = resource.config as KubernetesClusterConfig;
        if (config.enableSecretRotation && config.enableCsiSecretProvider) {
            ret.push({
                command: 'bash',
                args: ['-c', `az aks addon update --addon azure-keyvault-secrets-provider --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} --enable-secret-rotation || true`],
            });
        }

        // Attach ACR for image pulling (grants AcrPull to kubelet identity)
        if (config.attachAcr) {
            ret.push({
                command: 'bash',
                args: ['-c', `az aks update --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} --attach-acr ${config.attachAcr} || true`],
            });
        }

        return ret;
    }

    private static isKubernetesClusterResource(resource: Resource): resource is KubernetesClusterResource {
        return resource.type === KUBERNETES_CLUSTER_TYPE || resource.type === AZURE_AKS_TYPE;
    }

    protected async getDeployedProps(resource: Resource): Promise<KubernetesClusterConfig | undefined> {
        const resourceName = this.getResourceName(resource);
        const resourceGroup = this.getResourceGroupName(resource);

        try {
            const result = await execAsync('az', ['aks', 'show', '-g', resourceGroup, '-n', resourceName]);

            const d = JSON.parse(result);

            const config: KubernetesClusterConfig = {
                kubernetesVersion: d.currentKubernetesVersion,
                nodeCount: d.agentPoolProfiles?.[0]?.count,
                nodeVmSize: d.agentPoolProfiles?.[0]?.vmSize,
                nodePoolName: d.agentPoolProfiles?.[0]?.name,
                enableAutoScaling: d.agentPoolProfiles?.[0]?.enableAutoScaling,
                minCount: d.agentPoolProfiles?.[0]?.minCount,
                maxCount: d.agentPoolProfiles?.[0]?.maxCount,
                networkPlugin: d.networkProfile?.networkPlugin,
                networkPolicy: d.networkProfile?.networkPolicy,
                tags: d.tags,
            };

            return Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as KubernetesClusterConfig;

        } catch (error: any) {
            if (isResourceNotFoundError(error)) {
                return undefined;
            }
            throw new Error(
                `Failed to get deployed properties for AKS cluster ${resourceName} in resource group ${resourceGroup}: ${error}`
            );
        }
    }

    // ── Parameter maps ────────────────────────────────────────────────────────

    private static readonly SIMPLE_PARAM_MAP: Record<string, string> = {
        'kubernetesVersion': '--kubernetes-version',
        'networkPlugin': '--network-plugin',
        'networkPolicy': '--network-policy',
        'loadBalancerSku': '--load-balancer-sku',
    };

    private static readonly CREATE_ONLY_SIMPLE_PARAM_MAP: Record<string, string> = {
        'location': '--location',
        'nodeVmSize': '--node-vm-size',
        'nodePoolName': '--nodepool-name',
        'vnetSubnetId': '--vnet-subnet-id',
        'serviceCidr': '--service-cidr',
        'dnsServiceIp': '--dns-service-ip',
        'assignIdentity': '--assign-identity',
    };

    private static readonly SIMPLE_PARAM_MAP_UPDATE: Record<string, string> = {
        'kubernetesVersion': '--kubernetes-version',
        // `--network-policy` is supported on `az aks update` (azure | calico | cilium | none).
        // Switching policy engines triggers a node-image rolling update on the cluster, so it
        // applies in-place without recreating the cluster. networkPlugin is intentionally NOT
        // here — changing the CNI plugin requires cluster recreation.
        'networkPolicy': '--network-policy',
    };

    private static readonly BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableAutoScaling': '--enable-cluster-autoscaler',
    };

    private static readonly CREATE_ONLY_BOOLEAN_FLAG_MAP: Record<string, string> = {
        'enableManagedIdentity': '--enable-managed-identity',
        'enableAzureMonitor': '--enable-azure-monitor-metrics',
        'enableOidcIssuer': '--enable-oidc-issuer',
        'enableWorkloadIdentity': '--enable-workload-identity',
    };

    // ── Render methods ────────────────────────────────────────────────────────

    renderCreate(resource: KubernetesClusterResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('aks', 'create');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        if (config.nodeCount !== undefined) {
            args.push('--node-count', String(config.nodeCount));
        }
        if (config.minCount !== undefined && config.enableAutoScaling) {
            args.push('--min-count', String(config.minCount));
        }
        if (config.maxCount !== undefined && config.enableAutoScaling) {
            args.push('--max-count', String(config.maxCount));
        }

        this.addSimpleParams(args, config, AzureAKSRender.SIMPLE_PARAM_MAP);
        this.addSimpleParams(args, config, AzureAKSRender.CREATE_ONLY_SIMPLE_PARAM_MAP);
        this.addPresenceFlags(args, config, AzureAKSRender.BOOLEAN_FLAG_MAP);
        this.addPresenceFlags(args, config, AzureAKSRender.CREATE_ONLY_BOOLEAN_FLAG_MAP);

        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        // Always generate SSH keys if not present (required for AKS create)
        args.push('--generate-ssh-keys');

        const commands: Command[] = [{ command: 'az', args }];

        // CSI Secret Store Provider addon (must be added separately via --enable-addons)
        if (config.enableCsiSecretProvider) {
            // --enable-addons is additive on create; add it to the create args directly
            args.push('--enable-addons', 'azure-keyvault-secrets-provider');
        }

        return commands;
    }

    renderUpdate(resource: KubernetesClusterResource): Command[] {
        const args: string[] = [];
        const config = resource.config;

        args.push('aks', 'update');
        args.push('--name', this.getResourceName(resource));
        args.push('--resource-group', this.getResourceGroupName(resource));

        // Note: --node-count is NOT valid for `az aks update` (use `az aks nodepool scale`).
        // However, --min-count and --max-count ARE required when --enable-cluster-autoscaler is set.
        if (config.enableAutoScaling) {
            if (config.minCount !== undefined) {
                args.push('--min-count', String(config.minCount));
            }
            if (config.maxCount !== undefined) {
                args.push('--max-count', String(config.maxCount));
            }
        }

        this.addSimpleParams(args, config, AzureAKSRender.SIMPLE_PARAM_MAP_UPDATE);
        this.addPresenceFlags(args, config, AzureAKSRender.BOOLEAN_FLAG_MAP);

        // OIDC and Workload Identity can be enabled on existing clusters
        if (config.enableOidcIssuer) {
            args.push('--enable-oidc-issuer');
        }
        if (config.enableWorkloadIdentity) {
            args.push('--enable-workload-identity');
        }

        if (config.noWait === true) {
            args.push('--no-wait');
        }

        this.addTags(args, config.tags);

        const commands: Command[] = [{ command: 'az', args }];

        // Enable CSI Secret Store Provider addon on existing cluster
        if (config.enableCsiSecretProvider) {
            commands.push({
                command: 'bash',
                args: ['-c', `az aks enable-addons --addons azure-keyvault-secrets-provider --name ${this.getResourceName(resource)} --resource-group ${this.getResourceGroupName(resource)} || true`],
            });
        }

        return commands;
    }

    renderGetCredentials(resource: KubernetesClusterResource): Command[] {
        return [{
            command: 'az',
            args: [
                'aks', 'get-credentials',
                '--name', this.getResourceName(resource),
                '--resource-group', this.getResourceGroupName(resource),
                '--overwrite-existing',
            ],
        }];
    }
}
