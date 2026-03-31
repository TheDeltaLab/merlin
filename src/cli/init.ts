/**
 * `merlin init` — project scaffolding and template generation.
 *
 * Generates a complete set of Merlin resource YAML files in the project's
 * `merlin-resources/` directory, based on real-world patterns from
 * trinity and alluneed projects.
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

export type TemplateName = 'web' | 'worker' | 'api' | 'minimal';

export interface InitOptions {
    template: TemplateName;
    withAuth: boolean;
    dir: string;
}

interface TemplateFile {
    filename: string;
    description: string;
    content: string;
}

// ── Template generators ──────────────────────────────────────────────────────

function merlinYml(project: string): TemplateFile {
    return {
        filename: 'merlin.yml',
        description: 'project config',
        content: `project: ${project}
ring:
  - test
  - staging
region:
  - koreacentral
`,
    };
}

function appYml(project: string, opts: { ingress: boolean; withAuth: boolean }): TemplateFile {
    const ingressBlock = opts.ingress ? `
  ingress:
    subdomain: ${project}
    dnsZone: thebrainly.dev${opts.withAuth ? `
    annotations:
      nginx.ingress.kubernetes.io/auth-url: "https://$host/oauth2/auth"
      nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
      nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email"
    dependencies:
      - resource: KubernetesIngress.${project}-oauth2-proxy
        isHardDependency: true` : ''}` : '';

    return {
        filename: `${project}.yml`,
        description: 'KubernetesApp service',
        content: `name: ${project}
type: KubernetesApp

dependencies:
  - resource: KubernetesServiceAccount.${project}-workload-sa
    isHardDependency: true${opts.withAuth ? `
  - resource: AzureServicePrincipal.${project}-aad
    isHardDependency: true` : ''}

defaultConfig:
  namespace: ${project}
  image: brainlysharedstgkrcacr.azurecr.io/${project}:latest  # TODO: Change to your image
  port: 3000  # TODO: Change to your port
  serviceAccountName: ${project}-workload-sa
  secretProvider: ${project}-secret-provider
  envFrom:
    - secretRef: ${project}-secrets
  envVars:
    - APP_ENV=\${ this.ring }${ingressBlock}
`,
    };
}

function workloadSaYml(project: string): TemplateFile {
    return {
        filename: `${project}workloadsa.yml`,
        description: 'ServiceAccount',
        content: `name: ${project}-workload-sa
type: KubernetesServiceAccount

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: AzureServicePrincipal.kv-workload
    isHardDependency: true

defaultConfig:
  namespace: ${project}
  annotations:
    azure.workload.identity/client-id: \${ AzureServicePrincipal.kv-workload.clientId }
  labels:
    app.kubernetes.io/part-of: ${project}
    managed-by: merlin
`,
    };
}

function secretProviderYml(project: string): TemplateFile {
    return {
        filename: `${project}secretprovider.yml`,
        description: 'SecretProviderClass',
        content: `name: ${project}-secret-provider
type: KubernetesManifest

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: KubernetesServiceAccount.${project}-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.kv-workload
    isHardDependency: true
  - resource: AzureKeyVault.shared
    isHardDependency: true

defaultConfig:
  namespace: ${project}
  manifest: |
    apiVersion: secrets-store.csi.x-k8s.io/v1
    kind: SecretProviderClass
    metadata:
      name: ${project}-secret-provider
    spec:
      provider: azure
      parameters:
        usePodIdentity: "false"
        useVMManagedIdentity: "false"
        clientID: \${ AzureServicePrincipal.kv-workload.clientId }
        keyvaultName: \${ AzureKeyVault.shared.name }
        tenantId: "2c10b0b9-d9c1-4c81-85ee-6a2297ed77f4"  # TODO: Change to your tenant ID
        objects: |
          array:
            - |
              objectName: ${project}-example-secret
              objectType: secret
      secretObjects:
        - secretName: ${project}-secrets
          type: Opaque
          data:
            - objectName: ${project}-example-secret
              key: EXAMPLE_SECRET
`,
    };
}

function aadYml(project: string): TemplateFile {
    return {
        filename: `${project}aad.yml`,
        description: 'Azure AD App Registration',
        content: `name: ${project}-aad
type: AzureServicePrincipal
region: none

authProvider:
  name: AzureEntraID

dependencies:
  - resource: AzureKeyVault.shared
    isHardDependency: true

defaultConfig:
  displayName: ${project}-aad-\${ this.ring }
  webRedirectUris:
    - https://${project}.\${ this.ring }.thebrainly.dev/oauth2/callback
  assignmentRequired: true
  apiPermissions: oidc

specificConfig:
  - ring: test
    clientSecretKeyVault:
      vaultNames:
        - brainlysharedtstkrcakv
      secretName: ${project}-oauth2-proxy-client-secret
    cookieSecretKeyVault:
      vaultNames:
        - brainlysharedtstkrcakv
      secretName: ${project}-oauth2-proxy-cookie-secret
  - ring: staging
    clientSecretKeyVault:
      vaultNames:
        - brainlysharedstgkrcakv
      secretName: ${project}-oauth2-proxy-client-secret
    cookieSecretKeyVault:
      vaultNames:
        - brainlysharedstgkrcakv
      secretName: ${project}-oauth2-proxy-cookie-secret

exports:
  clientId: AzureServicePrincipalClientId
`,
    };
}

function oauth2ProxyYml(project: string): TemplateFile {
    return {
        filename: `${project}oauth2proxy.yml`,
        description: 'OAuth2 Proxy',
        content: `name: ${project}-oauth2-proxy
type: KubernetesApp

dependencies:
  - resource: KubernetesManifest.${project}-oauth2-proxy-secret-provider
    isHardDependency: true
  - resource: KubernetesServiceAccount.${project}-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.${project}-aad
    isHardDependency: true

defaultConfig:
  namespace: ${project}
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1
  port: 4180
  serviceAccountName: ${project}-workload-sa
  secretProvider: ${project}-oauth2-proxy-secret-provider
  resources:
    cpuRequest: "100m"
    memoryRequest: "128Mi"
    cpuLimit: "200m"
    memoryLimit: "256Mi"
  probes:
    liveness: false
    startup: false
    readiness:
      httpGet:
        path: /ping
        port: 4180
  envFrom:
    - secretRef: ${project}-oauth2-proxy-secrets
  envVars:
    - OAUTH2_PROXY_PROVIDER=oidc
    - OAUTH2_PROXY_OIDC_ISSUER_URL=https://login.microsoftonline.com/2c10b0b9-d9c1-4c81-85ee-6a2297ed77f4/v2.0
    - OAUTH2_PROXY_CLIENT_ID=\${ AzureServicePrincipal.${project}-aad.clientId }
    - OAUTH2_PROXY_REDIRECT_URL=https://${project}.\${ this.ring }.thebrainly.dev/oauth2/callback
    - OAUTH2_PROXY_UPSTREAM=static://202
    - OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180
    - OAUTH2_PROXY_EMAIL_DOMAINS=*
    - OAUTH2_PROXY_SCOPE=openid profile email
    - OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true
    - OAUTH2_PROXY_PASS_ACCESS_TOKEN=true
  ingress:
    subdomain: ${project}
    dnsZone: thebrainly.dev
    path: /oauth2
    bindDnsZone: false
    annotations:
      nginx.ingress.kubernetes.io/proxy-buffer-size: "8k"
      nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
`,
    };
}

function oauth2ProxySecretProviderYml(project: string): TemplateFile {
    return {
        filename: `${project}oauth2proxysecretprovider.yml`,
        description: 'OAuth2 Proxy SecretProviderClass',
        content: `name: ${project}-oauth2-proxy-secret-provider
type: KubernetesManifest

dependencies:
  - resource: KubernetesCluster.aks
    isHardDependency: true
  - resource: KubernetesServiceAccount.${project}-workload-sa
    isHardDependency: true
  - resource: AzureServicePrincipal.kv-workload
    isHardDependency: true
  - resource: AzureKeyVault.shared
    isHardDependency: true

defaultConfig:
  namespace: ${project}
  manifest: |
    apiVersion: secrets-store.csi.x-k8s.io/v1
    kind: SecretProviderClass
    metadata:
      name: ${project}-oauth2-proxy-secret-provider
    spec:
      provider: azure
      parameters:
        usePodIdentity: "false"
        useVMManagedIdentity: "false"
        clientID: \${ AzureServicePrincipal.kv-workload.clientId }
        keyvaultName: \${ AzureKeyVault.shared.name }
        tenantId: "2c10b0b9-d9c1-4c81-85ee-6a2297ed77f4"  # TODO: Change to your tenant ID
        objects: |
          array:
            - |
              objectName: ${project}-oauth2-proxy-client-secret
              objectType: secret
            - |
              objectName: ${project}-oauth2-proxy-cookie-secret
              objectType: secret
      secretObjects:
        - secretName: ${project}-oauth2-proxy-secrets
          type: Opaque
          data:
            - objectName: ${project}-oauth2-proxy-client-secret
              key: OAUTH2_PROXY_CLIENT_SECRET
            - objectName: ${project}-oauth2-proxy-cookie-secret
              key: OAUTH2_PROXY_COOKIE_SECRET
`,
    };
}

// ── Template set builders ────────────────────────────────────────────────────

function buildTemplateFiles(project: string, options: InitOptions): TemplateFile[] {
    const files: TemplateFile[] = [merlinYml(project)];

    switch (options.template) {
        case 'minimal':
            files.push(appYml(project, { ingress: false, withAuth: false }));
            break;

        case 'worker':
            files.push(
                appYml(project, { ingress: false, withAuth: false }),
                workloadSaYml(project),
                secretProviderYml(project),
            );
            break;

        case 'api':
            files.push(
                appYml(project, { ingress: true, withAuth: false }),
                workloadSaYml(project),
                secretProviderYml(project),
            );
            break;

        case 'web':
        default:
            if (options.withAuth) {
                files.push(
                    appYml(project, { ingress: true, withAuth: true }),
                    workloadSaYml(project),
                    secretProviderYml(project),
                    aadYml(project),
                    oauth2ProxyYml(project),
                    oauth2ProxySecretProviderYml(project),
                );
            } else {
                files.push(
                    appYml(project, { ingress: true, withAuth: false }),
                    workloadSaYml(project),
                    secretProviderYml(project),
                );
            }
            break;
    }

    return files;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs the init command — generates template files in the target directory.
 */
export async function runInit(projectName: string, options: InitOptions): Promise<void> {
    const outputDir = path.resolve(process.cwd(), options.dir);

    // Check if merlin.yml already exists
    if (existsSync(path.join(outputDir, 'merlin.yml'))) {
        console.log(`✅ merlin.yml already exists in ${options.dir}`);
        console.log('   To regenerate, delete the existing files first.');
        return;
    }

    // Build template files
    const files = buildTemplateFiles(projectName, options);

    // Create output directory
    mkdirSync(outputDir, { recursive: true });

    // Write all files
    for (const file of files) {
        const filePath = path.join(outputDir, file.filename);
        if (existsSync(filePath)) {
            console.log(`   ⏭️  ${file.filename} (already exists, skipped)`);
            continue;
        }
        writeFileSync(filePath, file.content, 'utf-8');
    }

    // Print summary
    console.log(`\n✅ Created ${options.dir}/ with ${files.length} files:`);
    for (const file of files) {
        console.log(`   - ${file.filename} (${file.description})`);
    }

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Edit ${projectName}.yml — set your container image and port`);
    console.log(`   2. Edit ${projectName}secretprovider.yml — configure Key Vault secrets`);
    if (options.withAuth) {
        console.log(`   3. Edit ${projectName}aad.yml — verify Azure AD tenant and redirect URIs`);
    }
    console.log(`   ${options.withAuth ? '4' : '3'}. merlin compile           # verify resources compile`);
    console.log(`   ${options.withAuth ? '5' : '4'}. merlin deploy            # dry-run (preview commands)`);
    console.log(`   ${options.withAuth ? '6' : '5'}. merlin deploy --execute  # deploy to test/koreacentral`);
    console.log('');
}
