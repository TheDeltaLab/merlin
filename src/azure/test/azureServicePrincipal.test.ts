import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureServicePrincipalRender,
    AzureServicePrincipalResource,
    AzureServicePrincipalConfig,
    AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
    DIRECTORY_ROLE_TEMPLATE_IDS,
} from '../azureServicePrincipal.js';

// Mock execAsync so it is replaceable in tests
vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, execAsync: vi.fn() };
});

import { execAsync } from '../../common/constants.js';
const mockExecAsync = vi.mocked(execAsync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureServicePrincipalConfig> = {},
    overrides: Partial<Omit<AzureServicePrincipalResource, 'config'>> = {}
): AzureServicePrincipalResource {
    return {
        name: 'github',
        type: AZURE_SERVICE_PRINCIPAL_RESOURCE_TYPE,
        ring: 'test',
        project: 'brainly',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            ...config,
        },
        ...overrides,
    } as AzureServicePrincipalResource;
}

/** Mock: app does not exist */
function mockNotFound(): void {
    mockExecAsync.mockImplementation(async () => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

/** Mock: app exists */
function mockAppExists(appId = 'app-id-123', objectId = 'object-id-123'): void {
    mockExecAsync.mockImplementation(async () => {
        return JSON.stringify([{ id: objectId, appId, displayName: 'brainly-github-tst' }]);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureServicePrincipalRender', () => {
    let render: AzureServicePrincipalRender;

    beforeEach(() => {
        render = new AzureServicePrincipalRender();
        vi.resetAllMocks();
    });

    // ── 1. Basic metadata ────────────────────────────────────────────────────

    describe('isGlobalResource', () => {
        it('is true (SPs are tenant-scoped)', () => {
            expect(render.isGlobalResource).toBe(true);
        });
    });

    describe('getResourceName', () => {
        it('uses project + name + ring abbreviation', () => {
            const resource = makeResource();
            expect(render.getResourceName(resource)).toBe('brainly-github-tst');
        });

        it('uses "shared" prefix when no project is set', () => {
            const resource = makeResource({}, { project: undefined });
            expect(render.getResourceName(resource)).toBe('shared-github-tst');
        });
    });

    describe('getDisplayName', () => {
        it('returns config.displayName when set', () => {
            const resource = makeResource({ displayName: 'brainly-github-tst' });
            expect(render.getDisplayName(resource)).toBe('brainly-github-tst');
        });

        it('falls back to getResourceName when displayName not set', () => {
            const resource = makeResource();
            expect(render.getDisplayName(resource)).toBe('brainly-github-tst');
        });
    });

    // ── 2. renderDirectoryRoles ──────────────────────────────────────────────

    describe('renderDirectoryRoles', () => {
        const APP_ID_VAR = 'MERLIN_SP_BRAINLY_GITHUB_TST_APP_ID';

        it('returns empty array when no directoryRoles configured', () => {
            const resource = makeResource();
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('returns empty array when directoryRoles is empty array', () => {
            const resource = makeResource({ directoryRoles: [] });
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('generates SP object ID capture + 1 bash command per role', () => {
            const resource = makeResource({ directoryRoles: ['Directory Readers'] });
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            // 1 capture command + 1 bash script for the role
            expect(cmds).toHaveLength(2);
        });

        it('captures SP object ID with az ad sp show (fallback to create)', () => {
            const resource = makeResource({ directoryRoles: ['Directory Readers'] });
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            const captureCmd = cmds[0];
            expect(captureCmd.command).toBe('bash');
            expect(captureCmd.args[1]).toContain('az ad sp show');
            expect(captureCmd.args[1]).toContain('az ad sp create');
            expect(captureCmd.envCapture).toBeDefined();
            expect(captureCmd.envCapture).toContain('SP_OID');
        });

        it('generates bash script that activates role template, gets role ID, and adds member', () => {
            const resource = makeResource({ directoryRoles: ['Directory Readers'] });
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            const bashCmd = cmds[1];
            expect(bashCmd.command).toBe('bash');
            expect(bashCmd.args[0]).toBe('-c');

            const script = bashCmd.args[1];
            // Should contain the role template ID for Directory Readers
            expect(script).toContain(DIRECTORY_ROLE_TEMPLATE_IDS['Directory Readers']);
            // Should activate the role template
            expect(script).toContain('directoryRoles');
            expect(script).toContain('--method post');
            // Should add SP as member
            expect(script).toContain('members');
            expect(script).toContain('servicePrincipals');
            // Should be idempotent (|| true)
            expect(script).toContain('|| true');
        });

        it('generates multiple bash commands for multiple roles', () => {
            const resource = makeResource({
                directoryRoles: ['Directory Readers', 'Global Reader'],
            });
            const cmds = render.renderDirectoryRoles(resource, APP_ID_VAR);
            // 1 capture + 2 bash scripts
            expect(cmds).toHaveLength(3);
            expect(cmds[1].args[1]).toContain(DIRECTORY_ROLE_TEMPLATE_IDS['Directory Readers']);
            expect(cmds[2].args[1]).toContain(DIRECTORY_ROLE_TEMPLATE_IDS['Global Reader']);
        });

        it('throws for unknown directory role names', () => {
            const resource = makeResource({ directoryRoles: ['Nonexistent Role'] });
            expect(() => render.renderDirectoryRoles(resource, APP_ID_VAR)).toThrow(
                'Unknown directory role "Nonexistent Role"'
            );
        });
    });

    // ── 3. renderCreate includes directoryRoles ──────────────────────────────

    describe('renderCreate with directoryRoles', () => {
        it('includes directory role commands at the end of create flow', () => {
            const resource = makeResource({
                displayName: 'brainly-github-tst',
                directoryRoles: ['Directory Readers'],
            });
            const cmds = render.renderCreate(resource);

            // Last command should be the bash script for directory roles
            const lastCmd = cmds[cmds.length - 1];
            expect(lastCmd.command).toBe('bash');
            expect(lastCmd.args[1]).toContain(DIRECTORY_ROLE_TEMPLATE_IDS['Directory Readers']);
        });
    });

    // ── 4. renderUpdate includes directoryRoles ──────────────────────────────

    describe('renderUpdate with directoryRoles', () => {
        it('includes directory role commands at the end of update flow', () => {
            const resource = makeResource({
                displayName: 'brainly-github-tst',
                directoryRoles: ['Directory Readers'],
            });
            const cmds = render.renderUpdate(resource, 'app-id-123', 'object-id-123');

            // Last command should be the bash script for directory roles
            const lastCmd = cmds[cmds.length - 1];
            expect(lastCmd.command).toBe('bash');
            expect(lastCmd.args[1]).toContain(DIRECTORY_ROLE_TEMPLATE_IDS['Directory Readers']);
        });
    });

    // ── 4b. renderClientSecret (idempotent) ──────────────────────────────────

    describe('renderClientSecret', () => {
        const APP_ID_VAR = 'MERLIN_SP_BRAINLY_GITHUB_TST_APP_ID';

        it('returns empty array when no clientSecretKeyVault configured', () => {
            const resource = makeResource();
            const cmds = render.renderClientSecret(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('emits an idempotent bash block that reuses KV value if present, else resets credential', () => {
            const resource = makeResource({
                clientSecretKeyVault: {
                    vaultNames: ['brainlysharedtstkrcakv'],
                    secretName: 'lovelace-oauth2-proxy-client-secret',
                },
            });
            const cmds = render.renderClientSecret(resource, APP_ID_VAR);

            // 1 capture bash + 1 keyvault secret set
            expect(cmds).toHaveLength(2);
            const captureCmd = cmds[0];
            expect(captureCmd.command).toBe('bash');
            expect(captureCmd.envCapture).toBeDefined();
            expect(captureCmd.envCapture).toContain('CLIENT_SECRET');

            const script = captureCmd.args[1];
            // Reads existing secret from first vault
            expect(script).toContain('az keyvault secret show');
            expect(script).toContain('brainlysharedtstkrcakv');
            expect(script).toContain('lovelace-oauth2-proxy-client-secret');
            // Falls back to credential reset when missing
            expect(script).toContain('az ad app credential reset');
            expect(script).toContain(`$${APP_ID_VAR}`);
            // Branching with EXISTING variable
            expect(script).toContain('EXISTING');
            expect(script).toContain('if [ -n "$EXISTING" ]');
        });

        it('writes the captured secret into every configured vault', () => {
            const resource = makeResource({
                clientSecretKeyVault: {
                    vaultNames: ['vault-a', 'vault-b', 'vault-c'],
                    secretName: 'my-secret',
                },
            });
            const cmds = render.renderClientSecret(resource, APP_ID_VAR);

            // 1 capture + 3 vault writes
            expect(cmds).toHaveLength(4);
            const vaults = cmds.slice(1).map(c => c.args[c.args.indexOf('--vault-name') + 1]);
            expect(vaults).toEqual(['vault-a', 'vault-b', 'vault-c']);
            cmds.slice(1).forEach(c => {
                expect(c.command).toBe('az');
                expect(c.args).toContain('secret');
                expect(c.args).toContain('set');
                expect(c.args).toContain('my-secret');
            });
        });
    });

    // ── 4c. renderUpdate invokes renderClientSecret ──────────────────────────

    describe('renderUpdate with clientSecretKeyVault', () => {
        it('includes idempotent client secret commands on update flow', () => {
            const resource = makeResource({
                displayName: 'brainly-github-tst',
                clientSecretKeyVault: {
                    vaultNames: ['brainlysharedtstkrcakv'],
                    secretName: 'lovelace-oauth2-proxy-client-secret',
                },
            });
            const cmds = render.renderUpdate(resource, 'app-id-123', 'object-id-123');

            // Find the bash capture emitted by renderClientSecret
            const captureCmd = cmds.find(
                c => c.command === 'bash'
                    && c.envCapture
                    && c.envCapture.includes('CLIENT_SECRET')
            );
            expect(captureCmd).toBeDefined();
            expect(captureCmd!.args[1]).toContain('az keyvault secret show');
            expect(captureCmd!.args[1]).toContain('az ad app credential reset');

            // And the subsequent keyvault secret set
            const setCmd = cmds.find(
                c => c.command === 'az'
                    && c.args.includes('secret')
                    && c.args.includes('set')
                    && c.args.includes('lovelace-oauth2-proxy-client-secret')
            );
            expect(setCmd).toBeDefined();
        });
    });

    // ── 5. renderRoleAssignments ─────────────────────────────────────────────

    describe('renderRoleAssignments', () => {
        const APP_ID_VAR = 'MERLIN_SP_BRAINLY_GITHUB_TST_APP_ID';

        it('returns empty array when no roleAssignments configured', () => {
            const resource = makeResource();
            const cmds = render.renderRoleAssignments(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('captures subscription ID + generates one bash command per assignment', () => {
            const resource = makeResource({
                roleAssignments: [
                    { role: 'Reader', scope: '/subscriptions/{subscriptionId}/resourceGroups/my-rg' },
                ],
            });
            const cmds = render.renderRoleAssignments(resource, APP_ID_VAR);
            // 1 subscription ID capture + 1 role assignment
            expect(cmds).toHaveLength(2);
            expect(cmds[0].envCapture).toContain('SUBSCRIPTION_ID');
            expect(cmds[1].command).toBe('bash');
            expect(cmds[1].args[1]).toContain('az role assignment create');
            expect(cmds[1].args[1]).toContain('Reader');
        });

        it('replaces {subscriptionId} placeholder with shell variable', () => {
            const resource = makeResource({
                roleAssignments: [
                    { role: 'Reader', scope: '/subscriptions/{subscriptionId}/resourceGroups/my-rg' },
                ],
            });
            const cmds = render.renderRoleAssignments(resource, APP_ID_VAR);
            const script = cmds[1].args[1];
            expect(script).not.toContain('{subscriptionId}');
            expect(script).toContain('$MERLIN_SP_BRAINLY_GITHUB_TST_SUBSCRIPTION_ID');
        });
    });

    // ── 6. renderFederatedCredentials ────────────────────────────────────────

    describe('renderFederatedCredentials', () => {
        const APP_ID_VAR = 'MERLIN_SP_BRAINLY_GITHUB_TST_APP_ID';

        it('returns empty array when no credentials configured', () => {
            const resource = makeResource();
            const cmds = render.renderFederatedCredentials(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('generates one bash command per credential', () => {
            const resource = makeResource({
                federatedCredentials: [
                    { name: 'cred-1', subject: 'repo:Org/Repo:environment:prod' },
                    { name: 'cred-2', subject: 'repo:Org/Repo:ref:refs/heads/main' },
                ],
            });
            const cmds = render.renderFederatedCredentials(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(2);
            expect(cmds[0].command).toBe('bash');
            expect(cmds[0].args[1]).toContain('cred-1');
            expect(cmds[1].args[1]).toContain('cred-2');
        });

        it('uses default GitHub Actions OIDC issuer', () => {
            const resource = makeResource({
                federatedCredentials: [
                    { name: 'cred-1', subject: 'repo:Org/Repo:environment:prod' },
                ],
            });
            const cmds = render.renderFederatedCredentials(resource, APP_ID_VAR);
            expect(cmds[0].args[1]).toContain('token.actions.githubusercontent.com');
        });

        it('is idempotent (try update first, fall back to create)', () => {
            const resource = makeResource({
                federatedCredentials: [
                    { name: 'cred-1', subject: 'repo:Org/Repo:environment:prod' },
                ],
            });
            const cmds = render.renderFederatedCredentials(resource, APP_ID_VAR);
            const script = cmds[0].args[1];
            expect(script).toContain('federated-credential update');
            expect(script).toContain('federated-credential create');
            expect(script).toContain('||');
        });
    });

    // ── 7. renderImpl dispatch ───────────────────────────────────────────────

    describe('renderImpl via render()', () => {
        it('calls renderCreate when app does not exist', async () => {
            mockNotFound();
            const resource = makeResource({ displayName: 'brainly-github-tst' });
            const cmds = await render.render(resource);
            // First command is the bash script that captures appId via list-first / create-fallback
            expect(cmds[0].command).toBe('bash');
            const script = cmds[0].args[1];
            expect(script).toContain('az ad app create');
            expect(script).toContain('--query appId');
            expect(cmds[0].envCapture).toBeDefined();
        });

        it('calls renderUpdate when app already exists', async () => {
            mockAppExists();
            const resource = makeResource({ displayName: 'brainly-github-tst' });
            const cmds = await render.render(resource);
            // First command is the bash script that captures appId via list-first / create-fallback
            expect(cmds[0].command).toBe('bash');
            const script = cmds[0].args[1];
            expect(script).toContain('az ad app list');
            expect(cmds[0].envCapture).toBeDefined();
        });
    });
});
