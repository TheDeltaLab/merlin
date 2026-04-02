import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AzureADAppRender,
    AzureADAppResource,
    AzureADAppConfig,
    AZURE_AD_APP_RESOURCE_TYPE,
} from '../azureADApp.js';

// Mock execAsync so it is replaceable in tests
vi.mock('../../common/constants.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, execAsync: vi.fn() };
});

import { execAsync } from '../../common/constants.js';
const mockExecAsync = vi.mocked(execAsync);

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeResource(
    config: Partial<AzureADAppConfig> = {},
    overrides: Partial<Omit<AzureADAppResource, 'config'>> = {}
): AzureADAppResource {
    return {
        name: 'myapp',
        type: AZURE_AD_APP_RESOURCE_TYPE,
        ring: 'staging',
        // No region — AD Apps are global
        project: 'merlintest',
        authProvider: { provider: {} as any, args: {} },
        dependencies: [],
        exports: {},
        config: {
            ...config,
        },
        ...overrides,
    } as AzureADAppResource;
}

/** Check if a flag + value pair is present in args */
function hasParam(args: string[], flag: string, value?: string): boolean {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    if (value === undefined) return true;
    return args[idx + 1] === value;
}

/** Mock: app does not exist */
function mockNotFound(): void {
    mockExecAsync.mockImplementation(async () => {
        const err: any = new Error('ResourceNotFound');
        err.status = 3;
        throw err;
    });
}

/** Mock: app exists with a given objectId */
function mockAppExists(objectId = 'object-id-123'): void {
    mockExecAsync.mockImplementation(async () => {
        return JSON.stringify([{ id: objectId, displayName: 'merlintest-myapp-stg' }]);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzureADAppRender', () => {
    let render: AzureADAppRender;

    beforeEach(() => {
        render = new AzureADAppRender();
        vi.resetAllMocks();
    });

    // ── 1. Basic metadata ────────────────────────────────────────────────────

    describe('getShortResourceTypeName', () => {
        it('returns aad', () => {
            expect(render.getShortResourceTypeName()).toBe('aad');
        });
    });

    describe('supportConnectorInResourceName', () => {
        it('is true (hyphens supported)', () => {
            expect(render.supportConnectorInResourceName).toBe(true);
        });
    });

    // ── 2. Resource naming ───────────────────────────────────────────────────

    describe('getResourceName', () => {
        it('uses project + name + ring abbreviation (no region, no type suffix)', () => {
            const resource = makeResource();
            expect(render.getResourceName(resource)).toBe('merlintest-myapp-stg');
        });

        it('uses "shared" prefix when no project is set', () => {
            const resource = makeResource({}, { project: undefined });
            expect(render.getResourceName(resource)).toBe('shared-myapp-stg');
        });

        it('abbreviates ring: test → tst', () => {
            const resource = makeResource({}, { ring: 'test' });
            expect(render.getResourceName(resource)).toBe('merlintest-myapp-tst');
        });

        it('abbreviates ring: production → prd', () => {
            const resource = makeResource({}, { ring: 'production' });
            expect(render.getResourceName(resource)).toBe('merlintest-myapp-prd');
        });

        it('ignores region even if one is set', () => {
            const resource = makeResource({}, { region: 'eastasia' } as any);
            // region must NOT appear in the name
            expect(render.getResourceName(resource)).toBe('merlintest-myapp-stg');
        });
    });

    describe('getDisplayName', () => {
        it('returns auto-generated name when displayName is not set', () => {
            const resource = makeResource();
            expect(render.getDisplayName(resource)).toBe('merlintest-myapp-stg');
        });

        it('returns config.displayName when explicitly set', () => {
            const resource = makeResource({ displayName: 'My Custom App' });
            expect(render.getDisplayName(resource)).toBe('My Custom App');
        });
    });

    // ── 3. renderCreate ──────────────────────────────────────────────────────

    describe('renderCreate', () => {
        it('uses az ad app create subcommand', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('ad');
            expect(cmd.args[1]).toBe('app');
            expect(cmd.args[2]).toBe('create');
        });

        it('includes --display-name', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--display-name', 'merlintest-myapp-stg')).toBe(true);
        });

        it('uses config.displayName when provided', () => {
            const resource = makeResource({ displayName: 'Custom Name' });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--display-name', 'Custom Name')).toBe(true);
        });

        it('includes --sign-in-audience when set', () => {
            const resource = makeResource({ signInAudience: 'AzureADMyOrg' });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--sign-in-audience', 'AzureADMyOrg')).toBe(true);
        });

        it('includes --web-home-page-url when set', () => {
            const resource = makeResource({ webHomepageUrl: 'https://myapp.example.com' });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--web-home-page-url', 'https://myapp.example.com')).toBe(true);
        });

        it('includes --enable-id-token-issuance true when set', () => {
            const resource = makeResource({ enableIdTokenIssuance: true });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--enable-id-token-issuance', 'true')).toBe(true);
        });

        it('includes --enable-access-token-issuance false when set to false', () => {
            const resource = makeResource({ enableAccessTokenIssuance: false });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--enable-access-token-issuance', 'false')).toBe(true);
        });

        it('includes --is-fallback-public-client when set', () => {
            const resource = makeResource({ isFallbackPublicClient: true });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--is-fallback-public-client', 'true')).toBe(true);
        });

        it('sets --identifier-uris via the update command (step 3), not the initial create', () => {
            const resource = makeResource({ identifierUris: ['api://merlintest-myapp-stg'] });
            const cmds = render.renderCreate(resource);
            // cmd[0]: az ad app create  — must NOT contain --identifier-uris
            expect(hasParam(cmds[0].args, '--identifier-uris')).toBe(false);
            // cmd[2]: az ad app update  — must contain --identifier-uris
            const updateCmd = cmds.find(c => c.args.includes('update'));
            expect(updateCmd).toBeDefined();
            expect(hasParam(updateCmd!.args, '--identifier-uris', 'api://merlintest-myapp-stg')).toBe(true);
        });

        it('includes --web-redirect-uris as space-separated string', () => {
            const resource = makeResource({ webRedirectUris: ['https://a.com/cb', 'https://b.com/cb'] });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--web-redirect-uris', 'https://a.com/cb https://b.com/cb')).toBe(true);
        });

        it('includes --public-client-redirect-uris when set', () => {
            const resource = makeResource({ publicClientRedirectUris: ['myapp://callback'] });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--public-client-redirect-uris', 'myapp://callback')).toBe(true);
        });

        it('includes --optional-claims JSON string when set', () => {
            const json = '{"accessToken":[{"name":"email"}]}';
            const resource = makeResource({ optionalClaims: json });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--optional-claims', json)).toBe(true);
        });

        it('includes --requested-access-token-version when set', () => {
            const resource = makeResource({ requestedAccessTokenVersion: 2 });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--requested-access-token-version', '2')).toBe(true);
        });

        it('includes --required-resource-accesses JSON string when set', () => {
            const json = '[{"resourceAppId":"00000003-0000-0000-c000-000000000000","resourceAccess":[]}]';
            const resource = makeResource({ requiredResourceAccesses: json });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--required-resource-accesses', json)).toBe(true);
        });

        it('includes --app-roles JSON string when set', () => {
            const json = '[{"displayName":"Admin","value":"admin"}]';
            const resource = makeResource({ appRoles: json });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--app-roles', json)).toBe(true);
        });

        it('includes --service-management-reference when set', () => {
            const resource = makeResource({ serviceManagementReference: 'some-ref' });
            const [cmd] = render.renderCreate(resource);
            expect(hasParam(cmd.args, '--service-management-reference', 'some-ref')).toBe(true);
        });

        it('omits optional params when not set in config', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).not.toContain('--sign-in-audience');
            expect(cmd.args).not.toContain('--web-redirect-uris');
            expect(cmd.args).not.toContain('--identifier-uris');
            expect(cmd.args).not.toContain('--enable-id-token-issuance');
        });

        it('does not include --resource-group (AD App has no RG)', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).not.toContain('--resource-group');
        });

        it('does not include --location (AD App has no region)', () => {
            const resource = makeResource();
            const [cmd] = render.renderCreate(resource);
            expect(cmd.args).not.toContain('--location');
        });

        it('returns exactly two commands (create + capture appId; no identifierUris, no sp create waits for appIdVar)', () => {
            const resource = makeResource();
            const cmds = render.renderCreate(resource);
            // cmd[0]: az ad app create
            // cmd[1]: az ad app list (capture appId)
            // cmd[2]: az ad sp create
            expect(cmds).toHaveLength(3);
        });

        it('returns three commands when identifierUris are set (create + capture + update-uris + sp-create)', () => {
            const resource = makeResource({ identifierUris: ['api://self'] });
            const cmds = render.renderCreate(resource);
            // cmd[0]: az ad app create
            // cmd[1]: az ad app list (capture appId)
            // cmd[2]: az ad app update --identifier-uris
            // cmd[3]: az ad sp create
            expect(cmds).toHaveLength(4);
        });

        it('last command is az ad sp create --id referencing the appId variable', () => {
            const resource = makeResource();
            const cmds = render.renderCreate(resource);
            const spCmd = cmds[cmds.length - 1];
            expect(spCmd.command).toBe('az');
            expect(spCmd.args[0]).toBe('ad');
            expect(spCmd.args[1]).toBe('sp');
            expect(spCmd.args[2]).toBe('create');
            expect(spCmd.args[3]).toBe('--id');
            // value must be a shell variable reference (starts with $)
            expect(spCmd.args[4]).toMatch(/^\$/);
        });
    });

    // ── 4. renderUpdate ──────────────────────────────────────────────────────

    describe('renderUpdate', () => {
        const OBJECT_ID = 'object-id-abc';

        it('uses az ad app update subcommand', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(cmd.command).toBe('az');
            expect(cmd.args[0]).toBe('ad');
            expect(cmd.args[1]).toBe('app');
            expect(cmd.args[2]).toBe('update');
        });

        it('uses --id with the provided objectId', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(hasParam(cmd.args, '--id', OBJECT_ID)).toBe(true);
        });

        it('does NOT include --display-name (used as lookup key, should not be changed)', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(cmd.args).not.toContain('--display-name');
        });

        it('includes optional params that are set', () => {
            const resource = makeResource({ signInAudience: 'AzureADMultipleOrgs' });
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(hasParam(cmd.args, '--sign-in-audience', 'AzureADMultipleOrgs')).toBe(true);
        });

        it('includes boolean flags that are set', () => {
            const resource = makeResource({ enableIdTokenIssuance: true });
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(hasParam(cmd.args, '--enable-id-token-issuance', 'true')).toBe(true);
        });

        it('includes array params that are set', () => {
            const resource = makeResource({ webRedirectUris: ['https://myapp.com/cb'] });
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(hasParam(cmd.args, '--web-redirect-uris', 'https://myapp.com/cb')).toBe(true);
        });

        it('does not include --resource-group', () => {
            const resource = makeResource();
            const [cmd] = render.renderUpdate(resource, OBJECT_ID);
            expect(cmd.args).not.toContain('--resource-group');
        });

        it('returns exactly one command', () => {
            const resource = makeResource();
            const cmds = render.renderUpdate(resource, OBJECT_ID);
            expect(cmds).toHaveLength(1);
        });
    });

    // ── 5. renderImpl dispatch ───────────────────────────────────────────────

    describe('renderImpl via render()', () => {
        it('calls renderCreate when app does not exist (exit code 3)', async () => {
            mockNotFound();
            const resource = makeResource();
            const cmds = await render.render(resource);
            // cmd[0]: az ad app create
            // cmd[1]: az ad app list (capture appId)
            // cmd[2]: az ad sp create
            expect(cmds).toHaveLength(3);
            expect(cmds[0].args).toContain('create');
            expect(cmds[0].args).not.toContain('update');
        });

        it('calls renderUpdate when app already exists', async () => {
            mockAppExists('object-id-xyz');
            const resource = makeResource();
            const cmds = await render.render(resource);
            expect(cmds).toHaveLength(1);
            expect(cmds[0].args).toContain('update');
            expect(hasParam(cmds[0].args, '--id', 'object-id-xyz')).toBe(true);
        });

        it('throws when resource type is wrong', async () => {
            mockNotFound();
            const resource = makeResource({}, { type: 'SomeOtherType' });
            await expect(render.render(resource)).rejects.toThrow('is not an Azure AD App resource');
        });

        it('propagates unexpected errors from getDeployedProps', async () => {
            mockExecAsync.mockImplementation(async () => {
                const err: any = new Error('Network failure');
                err.status = 255;
                throw err;
            });
            const resource = makeResource();
            await expect(render.render(resource)).rejects.toThrow('Failed to get deployed properties');
        });
    });

    // ── 6. renderClientSecrets ────────────────────────────────────────────────

    describe('renderClientSecrets', () => {
        const APP_ID_VAR = 'MERLIN_AAD_NEW_MERLINTEST_MYAPP_STG_APPID';

        it('returns empty array when no clientSecrets configured', () => {
            const resource = makeResource();
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('returns empty array when clientSecrets is empty array', () => {
            const resource = makeResource({ clientSecrets: [] });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(0);
        });

        it('generates bash -c command that checks existing credential before creating', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'oauth2-proxy',
                }],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(1);
            expect(cmds[0].command).toBe('bash');
            expect(cmds[0].args[0]).toBe('-c');

            const script = cmds[0].args[1];
            // Should check for existing credential
            expect(script).toContain('az ad app credential list');
            expect(script).toContain("displayName=='oauth2-proxy'");
            // Should conditionally create
            expect(script).toContain('if [ -z "$EXISTING" ]');
            expect(script).toContain('az ad app credential reset');
            expect(script).toContain('--append');
            expect(script).toContain('--display-name');
            expect(script).toContain('oauth2-proxy');
            expect(script).toContain(`$${APP_ID_VAR}`);
        });

        it('includes --end-date when specified', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'my-secret',
                    endDate: '2027-03-28',
                }],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            const script = cmds[0].args[1];
            expect(script).toContain('--end-date');
            expect(script).toContain('2027-03-28');
        });

        it('does not include --end-date when not specified', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'my-secret',
                }],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            const script = cmds[0].args[1];
            expect(script).not.toContain('--end-date');
        });

        it('includes keyvault secret set when storeInKeyVault is configured', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'oauth2-proxy',
                    storeInKeyVault: {
                        vaultName: 'my-vault',
                        secretName: 'oauth2-proxy-client-secret',
                    },
                }],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(1);
            const script = cmds[0].args[1];
            expect(script).toContain('az keyvault secret set');
            expect(script).toContain('--vault-name my-vault');
            expect(script).toContain('--name oauth2-proxy-client-secret');
        });

        it('does not include keyvault secret set when storeInKeyVault is not configured', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'my-secret',
                }],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            const script = cmds[0].args[1];
            expect(script).not.toContain('az keyvault secret set');
        });

        it('generates one command per client secret', () => {
            const resource = makeResource({
                clientSecrets: [
                    { displayName: 'secret-one' },
                    { displayName: 'secret-two', endDate: '2028-01-01' },
                ],
            });
            const cmds = render.renderClientSecrets(resource, APP_ID_VAR);
            expect(cmds).toHaveLength(2);
            expect(cmds[0].args[1]).toContain('secret-one');
            expect(cmds[1].args[1]).toContain('secret-two');
            expect(cmds[1].args[1]).toContain('--end-date');
        });

        it('appends client secret commands after create in full renderCreate', () => {
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'oauth2-proxy',
                    storeInKeyVault: {
                        vaultName: 'my-vault',
                        secretName: 'oauth2-proxy-client-secret',
                    },
                }],
            });
            const cmds = render.renderCreate(resource);
            // Last command should be the bash -c client secret creation
            const lastCmd = cmds[cmds.length - 1];
            expect(lastCmd.command).toBe('bash');
            expect(lastCmd.args[1]).toContain('az ad app credential reset');
        });

        it('captures appId and appends client secret commands in renderUpdate', () => {
            const OBJECT_ID = 'object-id-abc';
            const resource = makeResource({
                clientSecrets: [{
                    displayName: 'oauth2-proxy',
                }],
            });
            const cmds = render.renderUpdate(resource, OBJECT_ID);
            // First command should capture appId (needed for credential commands)
            expect(cmds[0].envCapture).toBeDefined();
            expect(cmds[0].envCapture).toContain('APPID');
            // Last command should be the bash -c client secret creation
            const lastCmd = cmds[cmds.length - 1];
            expect(lastCmd.command).toBe('bash');
            expect(lastCmd.args[1]).toContain('az ad app credential reset');
        });

        it('does not capture appId in renderUpdate when no clientSecrets and no api://self', () => {
            const OBJECT_ID = 'object-id-abc';
            const resource = makeResource();
            const cmds = render.renderUpdate(resource, OBJECT_ID);
            // Should just be the update command, no appId capture
            expect(cmds).toHaveLength(1);
            expect(cmds[0].envCapture).toBeUndefined();
        });
    });
});
