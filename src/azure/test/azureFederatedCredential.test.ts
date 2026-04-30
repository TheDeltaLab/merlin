import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureFederatedCredentialRender,
    AzureFederatedCredentialResource,
    AzureFederatedCredentialConfig,
    AZURE_FEDERATED_CREDENTIAL_RESOURCE_TYPE,
    GITHUB_ACTIONS_OIDC_ISSUER,
} from '../azureFederatedCredential.js';
import {
    AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
    AzureServicePrincipalRender,
    AzureServicePrincipalResource,
} from '../azureServicePrincipal.js';
import { registerResource, clearRegistry } from '../../common/registry.js';
import { registerRender } from '../../common/resource.js';

// Mock execAsync (not exercised here but registry stamping uses getRender)
vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = (await importOriginal()) as any;
    return { ...actual, execAsync: vi.fn() };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureFederatedCredentialConfig> = {},
    overrides: Partial<Omit<AzureFederatedCredentialResource, 'config'>> = {}
): AzureFederatedCredentialResource {
    return {
        name: 'github',
        type: AZURE_FEDERATED_CREDENTIAL_RESOURCE_TYPE,
        ring: 'test',
        project: 'trinity',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            servicePrincipal: 'github',
            subject: 'repo:TheDeltaLab/trinity:environment:nightly',
            ...config,
        },
        ...overrides,
    } as AzureFederatedCredentialResource;
}

function registerStubSp(
    name = 'github',
    ring: 'test' | 'staging' = 'test',
    displayName = 'brainly-github-tst'
): AzureServicePrincipalResource {
    const sp: AzureServicePrincipalResource = {
        name,
        type: AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
        ring,
        // No project → "shared" prefix in default getResourceName, but here we
        // pin displayName to match the real shared SP naming.
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: { displayName },
    } as AzureServicePrincipalResource;
    registerResource(sp);
    return sp;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AzureFederatedCredentialRender', () => {
    let render: AzureFederatedCredentialRender;

    beforeEach(() => {
        clearRegistry();
        // Ensure SP render is registered so getResource() can stamp
        // isGlobalResource on registered SP entries.
        registerRender(AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE, new AzureServicePrincipalRender());
        registerRender(
            AZURE_FEDERATED_CREDENTIAL_RESOURCE_TYPE,
            new AzureFederatedCredentialRender()
        );
        render = new AzureFederatedCredentialRender();
        vi.resetAllMocks();
    });

    describe('basic metadata', () => {
        it('isGlobalResource is true (tenant-scoped)', () => {
            expect(render.isGlobalResource).toBe(true);
        });

        it('getShortResourceTypeName returns fedcred', () => {
            expect(render.getShortResourceTypeName()).toBe('fedcred');
        });
    });

    describe('getCredentialName', () => {
        it('uses explicit credentialName when set', () => {
            const r = makeResource({ credentialName: 'custom-cred' });
            expect(render.getCredentialName(r)).toBe('custom-cred');
        });

        it('defaults to <project>-<name>', () => {
            const r = makeResource();
            expect(render.getCredentialName(r)).toBe('trinity-github');
        });

        it('falls back to <name> if no project', () => {
            const r = makeResource({}, { project: undefined });
            expect(render.getCredentialName(r)).toBe('github');
        });
    });

    describe('renderImpl - happy path', () => {
        it('emits 2 commands: capture appId + update-or-create fedcred', async () => {
            registerStubSp();
            const r = makeResource();
            const cmds = await render.render(r);

            expect(cmds).toHaveLength(2);

            const captureCmd = cmds[0];
            expect(captureCmd.command).toBe('bash');
            expect(captureCmd.envCapture).toBe(
                'MERLIN_FEDCRED_TRINITY_GITHUB_TST_APP_ID'
            );
            expect(captureCmd.args[1]).toContain(
                "az ad app list --filter \"displayName eq 'brainly-github-tst'\""
            );

            const fcCmd = cmds[1];
            expect(fcCmd.command).toBe('bash');
            expect(fcCmd.args[1]).toContain(
                'az ad app federated-credential update'
            );
            expect(fcCmd.args[1]).toContain('|| az ad app federated-credential create');
            expect(fcCmd.args[1]).toContain('trinity-github');
            expect(fcCmd.args[1]).toContain(
                'repo:TheDeltaLab/trinity:environment:nightly'
            );
        });

        it('uses GitHub Actions OIDC issuer by default', async () => {
            registerStubSp();
            const r = makeResource();
            const cmds = await render.render(r);
            expect(cmds[1].args[1]).toContain(GITHUB_ACTIONS_OIDC_ISSUER);
        });

        it('uses custom issuer when provided (e.g. AKS OIDC for K8s WI)', async () => {
            registerStubSp(
                'kv-workload',
                'test',
                'brainly-kv-workload-tst'
            );
            const r = makeResource(
                {
                    servicePrincipal: 'kv-workload',
                    issuer: 'https://oidc.aks.example.com/abc/',
                    subject: 'system:serviceaccount:trinity:trinity-workload-sa',
                    credentialName: 'trinity-sa',
                },
                { name: 'kv-workload' }
            );
            const cmds = await render.render(r);
            expect(cmds[1].args[1]).toContain('https://oidc.aks.example.com/abc/');
            expect(cmds[1].args[1]).toContain(
                'system:serviceaccount:trinity:trinity-workload-sa'
            );
            expect(cmds[1].args[1]).toContain('trinity-sa');
            // Should NOT also contain the GH OIDC issuer
            expect(cmds[1].args[1]).not.toContain(GITHUB_ACTIONS_OIDC_ISSUER);
        });

        it('embeds audiences=["api://AzureADTokenExchange"]', async () => {
            registerStubSp();
            const r = makeResource();
            const cmds = await render.render(r);
            expect(cmds[1].args[1]).toContain('api://AzureADTokenExchange');
        });
    });

    describe('renderImpl - error cases', () => {
        it('throws a clear error when target SP is not in the registry', async () => {
            const r = makeResource({ servicePrincipal: 'missing-sp' });
            await expect(render.render(r)).rejects.toThrow(
                /AzureServicePrincipal 'missing-sp' not found in registry/
            );
        });

        it('throws when servicePrincipal is missing from config', async () => {
            registerStubSp();
            const r = makeResource({ servicePrincipal: undefined as any });
            await expect(render.render(r)).rejects.toThrow(/'servicePrincipal' is required/);
        });
    });

    describe('cross-ring lookup', () => {
        it('finds the staging SP when resource ring is staging', async () => {
            registerStubSp('github', 'test', 'brainly-github-tst');
            registerStubSp('github', 'staging', 'brainly-github-stg');
            const r = makeResource(
                { subject: 'repo:TheDeltaLab/trinity:environment:staging' },
                { ring: 'staging' }
            );
            const cmds = await render.render(r);
            expect(cmds[0].args[1]).toContain('brainly-github-stg');
            expect(cmds[0].args[1]).not.toContain('brainly-github-tst');
            expect(cmds[0].envCapture).toBe(
                'MERLIN_FEDCRED_TRINITY_GITHUB_STG_APP_ID'
            );
        });
    });
});
