import { describe, it, expect } from 'vitest';
import { KubernetesNamespaceRender, KUBERNETES_NAMESPACE_TYPE, manifestToYaml } from '../kubernetesNamespace.js';
import { KubernetesDeploymentRender, KUBERNETES_DEPLOYMENT_TYPE } from '../kubernetesDeployment.js';
import { KubernetesServiceRender, KUBERNETES_SERVICE_TYPE } from '../kubernetesService.js';
import { KubernetesIngressRender, KUBERNETES_INGRESS_TYPE } from '../kubernetesIngress.js';
import { Resource } from '../../common/resource.js';

// ── manifestToYaml ────────────────────────────────────────────────────────────

describe('manifestToYaml', () => {
    it('serializes a simple object', () => {
        const yaml = manifestToYaml({ apiVersion: 'v1', kind: 'Namespace' });
        expect(yaml).toContain('apiVersion: v1');
        expect(yaml).toContain('kind: Namespace');
    });

    it('serializes nested objects', () => {
        const yaml = manifestToYaml({ metadata: { name: 'trinity', namespace: 'default' } });
        expect(yaml).toContain('metadata:');
        expect(yaml).toContain('name: trinity');
    });

    it('serializes arrays', () => {
        const yaml = manifestToYaml({ hosts: ['a.example.com', 'b.example.com'] });
        expect(yaml).toContain('- a.example.com');
        expect(yaml).toContain('- b.example.com');
    });

    it('serializes booleans', () => {
        expect(manifestToYaml(true)).toBe('true');
        expect(manifestToYaml(false)).toBe('false');
    });

    it('serializes numbers', () => {
        expect(manifestToYaml(42)).toBe('42');
    });

    it('quotes strings that need quoting', () => {
        // "true" as a string should be quoted
        const yaml = manifestToYaml({ flag: 'true' });
        expect(yaml).toContain('"true"');
    });
});

// ── KubernetesNamespaceRender ─────────────────────────────────────────────────

describe('KubernetesNamespaceRender', () => {
    const render = new KubernetesNamespaceRender();

    function makeNamespaceResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity',
            type: KUBERNETES_NAMESPACE_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [],
            exports: {},
            config,
        };
    }

    it('getShortResourceTypeName returns k8sns', () => {
        expect(render.getShortResourceTypeName()).toBe('k8sns');
    });

    it('renders kubectl apply with fileContent containing Namespace manifest', async () => {
        const resource = makeNamespaceResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].args).toContain('apply');
        expect(commands[0].args).toContain('__MERLIN_YAML_FILE__');
        expect(commands[0].fileContent).toContain('kind: Namespace');
        expect(commands[0].fileContent).toContain('name: trinity');
    });

    it('uses namespaceName config over resource.name', async () => {
        const resource = makeNamespaceResource({ namespaceName: 'custom-ns' });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('name: custom-ns');
    });

    it('includes labels when configured', async () => {
        const resource = makeNamespaceResource({ labels: { team: 'platform' } });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('team: platform');
    });

    it('includes annotations when configured', async () => {
        const resource = makeNamespaceResource({ annotations: { 'owner': 'merlin' } });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('owner: merlin');
    });
});

// ── KubernetesDeploymentRender ────────────────────────────────────────────────

describe('KubernetesDeploymentRender', () => {
    const render = new KubernetesDeploymentRender();

    function makeDeploymentResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-gateway',
            type: KUBERNETES_DEPLOYMENT_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                containers: [
                    {
                        name: 'gateway',
                        image: 'ghcr.io/example/gateway:latest',
                        port: 3000,
                    },
                ],
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8sdeploy', () => {
        expect(render.getShortResourceTypeName()).toBe('k8sdeploy');
    });

    it('renders kubectl apply with Deployment manifest', async () => {
        const resource = makeDeploymentResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].fileContent).toContain('kind: Deployment');
        expect(commands[0].fileContent).toContain('name: trinity-gateway');
        expect(commands[0].fileContent).toContain('namespace: trinity');
    });

    it('sets replicas in manifest', async () => {
        const resource = makeDeploymentResource({ replicas: 3 });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('replicas: 3');
    });

    it('defaults replicas to 1', async () => {
        const resource = makeDeploymentResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('replicas: 1');
    });

    it('includes container image', async () => {
        const resource = makeDeploymentResource();
        const commands = await render.render(resource);
        // URLs with colons/slashes get quoted in YAML
        expect(commands[0].fileContent).toContain('ghcr.io/example/gateway:latest');
    });

    it('includes containerPort when port is set', async () => {
        const resource = makeDeploymentResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('containerPort: 3000');
    });

    it('converts envVars KEY=VALUE strings to env entries', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envVars: ['NODE_ENV=staging', 'PORT=3000'],
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('name: NODE_ENV');
        expect(commands[0].fileContent).toContain('value: staging');
        expect(commands[0].fileContent).toContain('name: PORT');
        expect(commands[0].fileContent).toContain('value: "3000"');
    });

    it('includes resource requests/limits', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                cpuRequest: '250m',
                memoryRequest: '256Mi',
                cpuLimit: '500m',
                memoryLimit: '512Mi',
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        expect(yaml).toContain('cpu: 250m');
        expect(yaml).toContain('memory: 256Mi');
        expect(yaml).toContain('cpu: 500m');
        expect(yaml).toContain('memory: 512Mi');
    });

    it('includes liveness probe when set', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                livenessProbe: {
                    httpGet: { path: '/health', port: 3000 },
                    periodSeconds: 10,
                    failureThreshold: 3,
                },
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('livenessProbe:');
        expect(commands[0].fileContent).toContain('path: /health');
        expect(commands[0].fileContent).toContain('periodSeconds: 10');
    });

    it('includes imagePullSecrets when set', async () => {
        const resource = makeDeploymentResource({ imagePullSecrets: ['acr-secret'] });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('imagePullSecrets:');
        expect(commands[0].fileContent).toContain('name: acr-secret');
    });

    it('sets correct selector matchLabels', async () => {
        const resource = makeDeploymentResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('matchLabels:');
        expect(commands[0].fileContent).toContain('app: trinity-gateway');
    });

    // ── envFrom ─────────────────────────────────────────────────────────────

    it('renders envFrom with configMapRef', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [{ configMapRef: 'trinity-shared-config' }],
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('envFrom:');
        expect(commands[0].fileContent).toContain('configMapRef:');
        expect(commands[0].fileContent).toContain('name: trinity-shared-config');
    });

    it('renders envFrom with secretRef', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [{ secretRef: 'trinity-shared-secrets' }],
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('envFrom:');
        expect(commands[0].fileContent).toContain('secretRef:');
        expect(commands[0].fileContent).toContain('name: trinity-shared-secrets');
    });

    it('renders envFrom with both configMapRef and secretRef entries', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [
                    { configMapRef: 'trinity-shared-config' },
                    { secretRef: 'trinity-shared-secrets' },
                ],
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        expect(yaml).toContain('configMapRef:');
        expect(yaml).toContain('secretRef:');
    });

    it('renders envFrom with prefix', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [{ configMapRef: 'config', prefix: 'APP_' }],
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('prefix: APP_');
    });

    it('envFrom appears before env in manifest', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [{ configMapRef: 'config' }],
                envVars: ['OVERRIDE=true'],
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        const envFromIdx = yaml.indexOf('envFrom:');
        const envIdx = yaml.indexOf('env:');
        expect(envFromIdx).toBeGreaterThan(-1);
        expect(envIdx).toBeGreaterThan(envFromIdx);
    });

    // ── podLabels ─────────────────────────────────────────────────────────────

    it('includes podLabels in pod template labels', async () => {
        const resource = makeDeploymentResource({
            podLabels: { 'azure.workload.identity/use': 'true' },
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('azure.workload.identity/use');
        // "true" as string gets quoted
        expect(commands[0].fileContent).toContain('"true"');
    });

    it('podLabels merge with default app/ring labels', async () => {
        const resource = makeDeploymentResource({
            podLabels: { custom: 'value' },
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        expect(yaml).toContain('app: trinity-gateway');
        expect(yaml).toContain('ring: staging');
        expect(yaml).toContain('custom: value');
    });

    // ── serviceAccountName ────────────────────────────────────────────────────

    it('includes serviceAccountName in pod spec', async () => {
        const resource = makeDeploymentResource({
            serviceAccountName: 'trinity-workload-sa',
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('serviceAccountName: trinity-workload-sa');
    });

    // ── volumes ───────────────────────────────────────────────────────────────

    it('renders CSI volumes at pod spec level', async () => {
        const resource = makeDeploymentResource({
            volumes: [{
                name: 'secrets-store',
                csi: {
                    driver: 'secrets-store.csi.k8s.io',
                    readOnly: true,
                    volumeAttributes: {
                        secretProviderClass: 'trinity-secret-provider',
                    },
                },
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        expect(yaml).toContain('name: secrets-store');
        expect(yaml).toContain('driver: secrets-store.csi.k8s.io');
        expect(yaml).toContain('readOnly: true');
        expect(yaml).toContain('secretProviderClass: trinity-secret-provider');
    });

    // ── volumeMounts ──────────────────────────────────────────────────────────

    it('renders volumeMounts on containers', async () => {
        const resource = makeDeploymentResource({
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                volumeMounts: [{
                    name: 'secrets-store',
                    mountPath: '/mnt/secrets-store',
                    readOnly: true,
                }],
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;
        expect(yaml).toContain('volumeMounts:');
        expect(yaml).toContain('name: secrets-store');
        expect(yaml).toContain('mountPath: /mnt/secrets-store');
        expect(yaml).toContain('readOnly: true');
    });

    // ── Full CSI Secret Store integration ──────────────────────────────────────

    it('renders complete CSI Secret Store config (envFrom + volume + volumeMount + SA + podLabels)', async () => {
        const resource = makeDeploymentResource({
            serviceAccountName: 'trinity-workload-sa',
            podLabels: { 'azure.workload.identity/use': 'true' },
            containers: [{
                name: 'gateway',
                image: 'example/gateway:latest',
                envFrom: [
                    { configMapRef: 'trinity-shared-config' },
                    { secretRef: 'trinity-shared-secrets' },
                ],
                volumeMounts: [{
                    name: 'secrets-store',
                    mountPath: '/mnt/secrets-store',
                    readOnly: true,
                }],
            }],
            volumes: [{
                name: 'secrets-store',
                csi: {
                    driver: 'secrets-store.csi.k8s.io',
                    readOnly: true,
                    volumeAttributes: {
                        secretProviderClass: 'trinity-secret-provider',
                    },
                },
            }],
        });
        const commands = await render.render(resource);
        const yaml = commands[0].fileContent!;

        // Pod-level
        expect(yaml).toContain('serviceAccountName: trinity-workload-sa');
        expect(yaml).toContain('azure.workload.identity/use');

        // Container-level envFrom
        expect(yaml).toContain('configMapRef:');
        expect(yaml).toContain('secretRef:');

        // Volume + mount
        expect(yaml).toContain('driver: secrets-store.csi.k8s.io');
        expect(yaml).toContain('mountPath: /mnt/secrets-store');
    });
});

// ── KubernetesServiceRender ───────────────────────────────────────────────────

describe('KubernetesServiceRender', () => {
    const render = new KubernetesServiceRender();

    function makeServiceResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-gateway',
            type: KUBERNETES_SERVICE_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                ports: [{ port: 3000, targetPort: 3000 }],
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8ssvc', () => {
        expect(render.getShortResourceTypeName()).toBe('k8ssvc');
    });

    it('renders kubectl apply with Service manifest', async () => {
        const resource = makeServiceResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].fileContent).toContain('kind: Service');
        expect(commands[0].fileContent).toContain('name: trinity-gateway');
    });

    it('defaults to ClusterIP', async () => {
        const resource = makeServiceResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('type: ClusterIP');
    });

    it('sets LoadBalancer type when specified', async () => {
        const resource = makeServiceResource({ serviceType: 'LoadBalancer' });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('type: LoadBalancer');
    });

    it('adds azure internal LB annotation when internalLoadBalancer is true', async () => {
        const resource = makeServiceResource({ serviceType: 'LoadBalancer', internalLoadBalancer: true });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('service.beta.kubernetes.io/azure-load-balancer-internal');
        expect(commands[0].fileContent).toContain('"true"');
    });

    it('uses appName as selector shorthand', async () => {
        const resource = makeServiceResource({ appName: 'trinity-gateway' });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('app: trinity-gateway');
    });

    it('uses explicit selector over appName', async () => {
        const resource = makeServiceResource({ selector: { 'app.kubernetes.io/name': 'gateway' }, appName: 'ignored' });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('app.kubernetes.io/name');
        expect(commands[0].fileContent).toContain('gateway');
    });
});

// ── KubernetesIngressRender ───────────────────────────────────────────────────

describe('KubernetesIngressRender', () => {
    const render = new KubernetesIngressRender();

    function makeIngressResource(config: Record<string, unknown> = {}): Resource {
        return {
            name: 'trinity-ingress',
            type: KUBERNETES_INGRESS_TYPE,
            ring: 'staging',
            region: 'koreacentral',
            authProvider: { provider: {} as any, args: {} },
            dependencies: [],
            exports: {},
            config: {
                namespace: 'trinity',
                ingressClassName: 'nginx',
                rules: [
                    {
                        host: 'api.trinity.example.com',
                        paths: [
                            { path: '/', pathType: 'Prefix', serviceName: 'trinity-gateway', servicePort: 3000 },
                        ],
                    },
                ],
                ...config,
            },
        };
    }

    it('getShortResourceTypeName returns k8sing', () => {
        expect(render.getShortResourceTypeName()).toBe('k8sing');
    });

    it('renders kubectl apply with Ingress manifest', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('kubectl');
        expect(commands[0].fileContent).toContain('kind: Ingress');
        expect(commands[0].fileContent).toContain('name: trinity-ingress');
        expect(commands[0].fileContent).toContain('namespace: trinity');
    });

    it('sets ingressClassName', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('ingressClassName: nginx');
    });

    it('includes host and path rules', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('host: api.trinity.example.com');
        expect(commands[0].fileContent).toContain('path: /');
        expect(commands[0].fileContent).toContain('name: trinity-gateway');
    });

    it('adds cert-manager cluster-issuer annotation when clusterIssuer is set', async () => {
        const resource = makeIngressResource({ clusterIssuer: 'letsencrypt-prod' });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('cert-manager.io/cluster-issuer');
        expect(commands[0].fileContent).toContain('letsencrypt-prod');
    });

    it('includes TLS section when tls is configured', async () => {
        const resource = makeIngressResource({
            tls: [{ hosts: ['api.trinity.example.com'], secretName: 'trinity-tls' }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('tls:');
        expect(commands[0].fileContent).toContain('secretName: trinity-tls');
        expect(commands[0].fileContent).toContain('api.trinity.example.com');
    });

    it('uses networking.k8s.io/v1 apiVersion', async () => {
        const resource = makeIngressResource();
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('apiVersion: networking.k8s.io/v1');
    });

    it('defaults pathType to Prefix when not specified', async () => {
        const resource = makeIngressResource({
            rules: [{
                host: 'api.example.com',
                paths: [{ path: '/api', serviceName: 'svc', servicePort: 80 }],
            }],
        });
        const commands = await render.render(resource);
        expect(commands[0].fileContent).toContain('pathType: Prefix');
    });
});
