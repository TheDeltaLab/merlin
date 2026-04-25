import { describe, it, expect } from 'vitest';
import { expandKubernetesApp, KubernetesAppConfig } from '../kubernetesAppExpander.js';
import { createResourceYAML } from '../../test-utils/factories.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createKubernetesApp(config: KubernetesAppConfig, overrides?: Record<string, unknown>) {
    return createResourceYAML({
        name: 'my-app',
        type: 'KubernetesApp',
        project: 'merlin',
        ring: ['test', 'staging'],
        region: ['koreacentral', 'eastasia'],
        authProvider: 'AzureEntraID',
        dependencies: [],
        defaultConfig: config as unknown as Record<string, unknown>,
        specificConfig: [],
        exports: {},
        ...overrides,
    });
}

const MINIMAL_CONFIG: KubernetesAppConfig = {
    namespace: 'trinity',
    image: 'myregistry.azurecr.io/my-app:latest',
    port: 3000,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('kubernetesAppExpander', () => {
    describe('expandKubernetesApp', () => {
        it('returns 2 resources (Deployment + Service) without ingress', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const result = expandKubernetesApp(resource);

            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('KubernetesDeployment');
            expect(result[1].type).toBe('KubernetesService');
        });

        it('returns 3 resources (Deployment + Service + Ingress) with ingress', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'home',
                    dnsZone: 'thebrainly.dev',
                },
            });
            const result = expandKubernetesApp(resource);

            expect(result).toHaveLength(3);
            expect(result[0].type).toBe('KubernetesDeployment');
            expect(result[1].type).toBe('KubernetesService');
            expect(result[2].type).toBe('KubernetesIngress');
        });

        it('preserves name, project, ring, region, authProvider on all expanded resources', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const result = expandKubernetesApp(resource);

            for (const r of result) {
                expect(r.name).toBe('my-app');
                expect(r.project).toBe('merlin');
                expect(r.ring).toEqual(['test', 'staging']);
                expect(r.region).toEqual(['koreacentral', 'eastasia']);
                expect(r.authProvider).toBe('AzureEntraID');
            }
        });
    });

    describe('Deployment resource', () => {
        it('generates correct namespace and replicas', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;

            expect(config.namespace).toBe('trinity');
            expect(config.replicas).toBe(1); // default
        });

        it('respects custom replicas', () => {
            const resource = createKubernetesApp({ ...MINIMAL_CONFIG, replicas: 3 });
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;

            expect(config.replicas).toBe(3);
        });

        it('generates container with correct image and port', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers).toHaveLength(1);
            expect(containers[0].image).toBe('myregistry.azurecr.io/my-app:latest');
            expect(containers[0].port).toBe(3000);
        });

        it('derives container name from resource name', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG, { name: 'trinity-home' });
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            // Last segment after split('-')
            expect(containers[0].name).toBe('home');
        });

        it('uses custom containerName when provided', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                containerName: 'web-server',
            });
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers[0].name).toBe('web-server');
        });

        it('applies default resource limits', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers[0].cpuRequest).toBe('100m');
            expect(containers[0].memoryRequest).toBe('512Mi');
            expect(containers[0].cpuLimit).toBe('500m');
            expect(containers[0].memoryLimit).toBe('1Gi');
        });

        it('applies custom resource limits', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                resources: {
                    cpuRequest: '125m',
                    memoryRequest: '256Mi',
                    cpuLimit: '1',
                    memoryLimit: '2Gi',
                },
            });
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers[0].cpuRequest).toBe('125m');
            expect(containers[0].memoryRequest).toBe('256Mi');
            expect(containers[0].cpuLimit).toBe('1');
            expect(containers[0].memoryLimit).toBe('2Gi');
        });

        it('applies default imagePullPolicy', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers[0].imagePullPolicy).toBe('IfNotPresent');
        });

        it('applies custom imagePullPolicy', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                imagePullPolicy: 'Always',
            });
            const [deployment] = expandKubernetesApp(resource);
            const config = deployment.defaultConfig as Record<string, unknown>;
            const containers = config.containers as Record<string, unknown>[];

            expect(containers[0].imagePullPolicy).toBe('Always');
        });

        describe('probes', () => {
            it('generates default liveness, readiness, and startup probes', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG);
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];
                const container = containers[0] as Record<string, unknown>;

                expect(container.livenessProbe).toBeDefined();
                expect(container.readinessProbe).toBeDefined();
                expect(container.startupProbe).toBeDefined();

                // Check default healthPath
                const liveness = container.livenessProbe as Record<string, unknown>;
                const httpGet = liveness.httpGet as Record<string, unknown>;
                expect(httpGet.path).toBe('/');
                expect(httpGet.port).toBe(3000);
            });

            it('uses custom healthPath for probes', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    healthPath: '/healthz',
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];
                const container = containers[0] as Record<string, unknown>;

                const liveness = container.livenessProbe as Record<string, unknown>;
                expect((liveness.httpGet as Record<string, unknown>).path).toBe('/healthz');
            });

            it('disables all probes when probes: false', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    probes: false,
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];
                const container = containers[0] as Record<string, unknown>;

                expect(container.livenessProbe).toBeUndefined();
                expect(container.readinessProbe).toBeUndefined();
                expect(container.startupProbe).toBeUndefined();
            });

            it('can disable individual probes', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    probes: {
                        liveness: false,
                        startup: false,
                    },
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];
                const container = containers[0] as Record<string, unknown>;

                expect(container.livenessProbe).toBeUndefined();
                expect(container.readinessProbe).toBeDefined();
                expect(container.startupProbe).toBeUndefined();
            });

            it('supports custom probe config', () => {
                const customProbe = { exec: { command: ['cat', '/tmp/healthy'] }, periodSeconds: 30 };
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    probes: { liveness: customProbe },
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];
                const container = containers[0] as Record<string, unknown>;

                expect(container.livenessProbe).toEqual(customProbe);
                // readiness and startup should still have defaults
                expect(container.readinessProbe).toBeDefined();
                expect(container.startupProbe).toBeDefined();
            });
        });

        describe('envFrom and envVars', () => {
            it('passes envFrom to container', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    envFrom: [{ configMapRef: 'my-config' }, { secretRef: 'my-secrets' }],
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];

                expect(containers[0].envFrom).toEqual([
                    { configMapRef: 'my-config' },
                    { secretRef: 'my-secrets' },
                ]);
            });

            it('passes envVars to container', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    envVars: ['FOO=bar', 'BAZ=qux'],
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];

                expect(containers[0].envVars).toEqual(['FOO=bar', 'BAZ=qux']);
            });
        });

        describe('workload identity', () => {
            it('adds serviceAccountName and podLabels when serviceAccountName is set', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    serviceAccountName: 'my-sa',
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;

                expect(config.serviceAccountName).toBe('my-sa');
                expect(config.podLabels).toEqual({ 'azure.workload.identity/use': 'true' });
            });

            it('does not add podLabels without serviceAccountName', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG);
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;

                expect(config.serviceAccountName).toBeUndefined();
                expect(config.podLabels).toBeUndefined();
            });
        });

        describe('secrets volume (CSI)', () => {
            it('adds CSI volume and volumeMount when secretProvider is set', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    secretProvider: 'my-secret-provider',
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];

                // Container should have volumeMount
                expect(containers[0].volumeMounts).toEqual([
                    { name: 'secrets-store', mountPath: '/mnt/secrets-store', readOnly: true },
                ]);

                // Deployment config should have volume
                expect(config.volumes).toEqual([{
                    name: 'secrets-store',
                    csi: {
                        driver: 'secrets-store.csi.k8s.io',
                        readOnly: true,
                        volumeAttributes: {
                            secretProviderClass: 'my-secret-provider',
                        },
                    },
                }]);
            });

            it('does not add volume without secretProvider', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG);
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;
                const containers = config.containers as Record<string, unknown>[];

                expect(containers[0].volumeMounts).toBeUndefined();
                expect(config.volumes).toBeUndefined();
            });
        });

        describe('dependencies', () => {
            it('auto-adds KubernetesCluster.aks dependency', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG);
                const [deployment] = expandKubernetesApp(resource);

                expect(deployment.dependencies).toContainEqual({
                    resource: 'KubernetesCluster.aks',
                    isHardDependency: true,
                });
            });

            it('does not duplicate KubernetesCluster.aks if already declared', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG, {
                    dependencies: [{ resource: 'KubernetesCluster.aks', isHardDependency: true }],
                });
                const [deployment] = expandKubernetesApp(resource);

                const aksDeps = deployment.dependencies!.filter(
                    d => d.resource === 'KubernetesCluster.aks'
                );
                expect(aksDeps).toHaveLength(1);
            });

            it('preserves user-declared dependencies', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG, {
                    dependencies: [
                        { resource: 'KubernetesManifest.my-secret-provider', isHardDependency: true },
                    ],
                });
                const [deployment] = expandKubernetesApp(resource);

                expect(deployment.dependencies).toContainEqual({
                    resource: 'KubernetesManifest.my-secret-provider',
                    isHardDependency: true,
                });
                expect(deployment.dependencies).toContainEqual({
                    resource: 'KubernetesCluster.aks',
                    isHardDependency: true,
                });
            });
        });

        describe('deploymentOverrides', () => {
            it('applies deploymentOverrides to config', () => {
                const resource = createKubernetesApp({
                    ...MINIMAL_CONFIG,
                    deploymentOverrides: {
                        strategy: { type: 'RollingUpdate' },
                        terminationGracePeriodSeconds: 60,
                    },
                });
                const [deployment] = expandKubernetesApp(resource);
                const config = deployment.defaultConfig as Record<string, unknown>;

                expect(config.strategy).toEqual({ type: 'RollingUpdate' });
                expect(config.terminationGracePeriodSeconds).toBe(60);
            });
        });

        describe('specificConfig forwarding', () => {
            it('forwards non-ingress specificConfig to deployment', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG, {
                    specificConfig: [
                        { ring: 'staging', replicas: 2 },
                    ],
                });
                const [deployment] = expandKubernetesApp(resource);

                expect(deployment.specificConfig).toContainEqual({ ring: 'staging', replicas: 2 });
            });

            it('strips ingress field from specificConfig entries', () => {
                const resource = createKubernetesApp(
                    { ...MINIMAL_CONFIG, ingress: { subdomain: 'home', dnsZone: 'thebrainly.dev' } },
                    {
                        specificConfig: [
                            { ring: 'staging', replicas: 2, ingress: { annotations: { foo: 'bar' } } },
                        ],
                    },
                );
                const [deployment] = expandKubernetesApp(resource);

                // Deployment specificConfig should not have ingress
                for (const sc of deployment.specificConfig ?? []) {
                    expect((sc as Record<string, unknown>).ingress).toBeUndefined();
                }
            });

            it('filters out entries with only ring/region (no other fields)', () => {
                const resource = createKubernetesApp(MINIMAL_CONFIG, {
                    specificConfig: [
                        { ring: 'staging' }, // only ring, no config fields
                        { ring: 'staging', replicas: 2 }, // has actual config
                    ],
                });
                const [deployment] = expandKubernetesApp(resource);

                expect(deployment.specificConfig).toHaveLength(1);
                expect(deployment.specificConfig![0]).toEqual({ ring: 'staging', replicas: 2 });
            });
        });
    });

    describe('Service resource', () => {
        it('generates ClusterIP service with correct config', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const result = expandKubernetesApp(resource);
            const service = result[1];
            const config = service.defaultConfig as Record<string, unknown>;

            expect(config.namespace).toBe('trinity');
            expect(config.serviceType).toBe('ClusterIP');
            expect(config.appName).toBe('my-app');
            expect(config.ports).toEqual([{ port: 3000, targetPort: 3000 }]);
        });

        it('depends on the generated Deployment', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const result = expandKubernetesApp(resource);
            const service = result[1];

            expect(service.dependencies).toContainEqual({
                resource: 'KubernetesDeployment.my-app',
                isHardDependency: true,
            });
        });

        it('applies serviceOverrides', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                serviceOverrides: {
                    serviceType: 'LoadBalancer',
                    externalTrafficPolicy: 'Local',
                },
            });
            const result = expandKubernetesApp(resource);
            const service = result[1];
            const config = service.defaultConfig as Record<string, unknown>;

            expect(config.serviceType).toBe('LoadBalancer');
            expect(config.externalTrafficPolicy).toBe('Local');
        });

        it('has empty specificConfig and exports', () => {
            const resource = createKubernetesApp(MINIMAL_CONFIG);
            const result = expandKubernetesApp(resource);
            const service = result[1];

            expect(service.specificConfig).toEqual([]);
            expect(service.exports).toEqual({});
        });
    });

    describe('Ingress resource', () => {
        const INGRESS_CONFIG: KubernetesAppConfig = {
            ...MINIMAL_CONFIG,
            ingress: {
                subdomain: 'home',
                dnsZone: 'thebrainly.dev',
            },
        };

        it('generates ingress with ${ this.ring } interpolation in host', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;
            const rules = config.rules as Record<string, unknown>[];

            expect(rules[0].host).toBe('home.${ this.ring }.thebrainly.dev');
        });

        it('uses default nginx ingress class and letsencrypt-prod cluster issuer', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.ingressClassName).toBe('nginx');
            expect(config.clusterIssuer).toBe('letsencrypt-prod');
        });

        it('generates TLS config with correct hosts and secret name', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;
            const tls = config.tls as Record<string, unknown>[];

            expect(tls[0].hosts).toEqual(['home.${ this.ring }.thebrainly.dev']);
            expect(tls[0].secretName).toBe('my-app-tls');
        });

        it('uses default path /', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;
            const rules = config.rules as Record<string, unknown>[];
            const paths = (rules[0] as Record<string, unknown>).paths as Record<string, unknown>[];

            expect(paths[0].path).toBe('/');
            expect(paths[0].pathType).toBe('Prefix');
            expect(paths[0].serviceName).toBe('my-app');
            expect(paths[0].servicePort).toBe(3000);
        });

        it('supports custom ingress path', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'api',
                    dnsZone: 'thebrainly.dev',
                    path: '/v1',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;
            const rules = config.rules as Record<string, unknown>[];
            const paths = (rules[0] as Record<string, unknown>).paths as Record<string, unknown>[];

            expect(paths[0].path).toBe('/v1');
        });

        it('supports custom ingressClassName and clusterIssuer', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'home',
                    dnsZone: 'thebrainly.dev',
                    ingressClassName: 'traefik',
                    clusterIssuer: 'letsencrypt-staging',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.ingressClassName).toBe('traefik');
            expect(config.clusterIssuer).toBe('letsencrypt-staging');
        });

        it('includes bindDnsZone by default', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.bindDnsZone).toEqual({ dnsZone: 'thebrainly.dev' });
        });

        it('excludes bindDnsZone when explicitly disabled', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'home',
                    dnsZone: 'thebrainly.dev',
                    bindDnsZone: false,
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.bindDnsZone).toBeUndefined();
        });

        it('includes custom annotations', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'admin',
                    dnsZone: 'thebrainly.dev',
                    annotations: {
                        'nginx.ingress.kubernetes.io/auth-url': 'https://$host/oauth2/auth',
                        'nginx.ingress.kubernetes.io/auth-signin': 'https://$host/oauth2/start',
                    },
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.annotations).toEqual({
                'nginx.ingress.kubernetes.io/auth-url': 'https://$host/oauth2/auth',
                'nginx.ingress.kubernetes.io/auth-signin': 'https://$host/oauth2/start',
            });
        });

        it('depends on the generated Service', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];

            expect(ingress.dependencies).toContainEqual({
                resource: 'KubernetesService.my-app',
                isHardDependency: true,
            });
        });

        it('includes extra ingress dependencies', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'admin',
                    dnsZone: 'thebrainly.dev',
                    dependencies: [
                        { resource: 'KubernetesHelmRelease.oauth2-proxy', isHardDependency: true },
                    ],
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];

            expect(ingress.dependencies).toContainEqual({
                resource: 'KubernetesService.my-app',
                isHardDependency: true,
            });
            expect(ingress.dependencies).toContainEqual({
                resource: 'KubernetesHelmRelease.oauth2-proxy',
                isHardDependency: true,
            });
        });

        it('applies ingressOverrides', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    subdomain: 'home',
                    dnsZone: 'thebrainly.dev',
                },
                ingressOverrides: {
                    customField: 'custom-value',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.customField).toBe('custom-value');
        });

        it('has empty specificConfig and exports', () => {
            const resource = createKubernetesApp(INGRESS_CONFIG);
            const result = expandKubernetesApp(resource);
            const ingress = result[2];

            expect(ingress.specificConfig).toEqual([]);
            expect(ingress.exports).toEqual({});
        });

        it('uses custom host when provided', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    host: '${ this.ring }.web.thebrainly.dev',
                    dnsZone: 'thebrainly.dev',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;
            const rules = config.rules as Record<string, unknown>[];
            const tls = config.tls as Record<string, unknown>[];

            expect(rules[0].host).toBe('${ this.ring }.web.thebrainly.dev');
            expect(tls[0].hosts).toEqual(['${ this.ring }.web.thebrainly.dev']);
        });

        it('uses custom host with bindDnsZone when dnsZone is also provided', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    host: '${ this.ring }.web.thebrainly.dev',
                    dnsZone: 'thebrainly.dev',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.bindDnsZone).toEqual({ dnsZone: 'thebrainly.dev' });
        });

        it('skips bindDnsZone when custom host is provided without dnsZone', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {
                    host: '${ this.ring }.web.thebrainly.dev',
                },
            });
            const result = expandKubernetesApp(resource);
            const ingress = result[2];
            const config = ingress.defaultConfig as Record<string, unknown>;

            expect(config.bindDnsZone).toBeUndefined();
        });

        it('throws when neither host nor subdomain+dnsZone is provided', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: {} as never,
            });

            expect(() => expandKubernetesApp(resource)).toThrow(
                'ingress requires either "host" or both "subdomain" and "dnsZone"',
            );
        });

        it('throws when only subdomain is provided without dnsZone', () => {
            const resource = createKubernetesApp({
                ...MINIMAL_CONFIG,
                ingress: { subdomain: 'web' } as never,
            });

            expect(() => expandKubernetesApp(resource)).toThrow(
                'ingress requires either "host" or both "subdomain" and "dnsZone"',
            );
        });
    });

    describe('full integration: complex app', () => {
        it('generates all resources for a fully-configured app', () => {
            const resource = createKubernetesApp({
                namespace: 'trinity',
                image: 'myregistry.azurecr.io/trinity/admin:nightly',
                port: 3000,
                replicas: 2,
                healthPath: '/healthz',
                serviceAccountName: 'trinity-workload-sa',
                secretProvider: 'trinity-secret-provider',
                envFrom: [
                    { configMapRef: 'trinity-shared-config' },
                    { secretRef: 'trinity-shared-secrets' },
                ],
                envVars: ['OTEL_EXPORTER_OTLP_ENDPOINT=', 'NODE_ENV=production'],
                resources: {
                    cpuRequest: '500m',
                    memoryRequest: '1Gi',
                    cpuLimit: '1',
                    memoryLimit: '2Gi',
                },
                ingress: {
                    subdomain: 'admin',
                    dnsZone: 'thebrainly.dev',
                    annotations: {
                        'nginx.ingress.kubernetes.io/auth-url': 'https://$host/oauth2/auth',
                    },
                    dependencies: [
                        { resource: 'KubernetesHelmRelease.oauth2-proxy', isHardDependency: true },
                    ],
                },
            }, {
                name: 'trinity-admin',
                dependencies: [
                    { resource: 'KubernetesManifest.trinity-secret-provider', isHardDependency: true },
                    { resource: 'KubernetesServiceAccount.trinity-workload-sa', isHardDependency: true },
                ],
            });

            const result = expandKubernetesApp(resource);

            // Should produce 3 resources
            expect(result).toHaveLength(3);

            // Deployment
            const deployment = result[0];
            expect(deployment.type).toBe('KubernetesDeployment');
            const depConfig = deployment.defaultConfig as Record<string, unknown>;
            expect(depConfig.replicas).toBe(2);
            expect(depConfig.serviceAccountName).toBe('trinity-workload-sa');
            expect(depConfig.podLabels).toEqual({ 'azure.workload.identity/use': 'true' });
            expect(depConfig.volumes).toBeDefined();

            const containers = depConfig.containers as Record<string, unknown>[];
            expect(containers[0].envFrom).toHaveLength(2);
            expect(containers[0].envVars).toHaveLength(2);
            expect(containers[0].volumeMounts).toBeDefined();
            expect(containers[0].cpuRequest).toBe('500m');

            // Dependencies: original + auto-added KubernetesCluster.aks
            expect(deployment.dependencies).toContainEqual({
                resource: 'KubernetesCluster.aks',
                isHardDependency: true,
            });
            expect(deployment.dependencies).toContainEqual({
                resource: 'KubernetesManifest.trinity-secret-provider',
                isHardDependency: true,
            });

            // Service
            const service = result[1];
            expect(service.type).toBe('KubernetesService');
            expect(service.dependencies).toContainEqual({
                resource: 'KubernetesDeployment.trinity-admin',
                isHardDependency: true,
            });

            // Ingress
            const ingress = result[2];
            expect(ingress.type).toBe('KubernetesIngress');
            const ingressConfig = ingress.defaultConfig as Record<string, unknown>;
            expect(ingressConfig.annotations).toBeDefined();
            expect(ingress.dependencies).toContainEqual({
                resource: 'KubernetesService.trinity-admin',
                isHardDependency: true,
            });
            expect(ingress.dependencies).toContainEqual({
                resource: 'KubernetesHelmRelease.oauth2-proxy',
                isHardDependency: true,
            });
        });
    });
});
