import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureManagedIdentityAuthProvider } from '../authProvider.js';
import * as resourceModule from '../../common/resource.js';
import type { Resource, Render } from '../../common/resource.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRender(resourceName: string, resourceGroupName: string): Render & { getResourceName: any; getResourceGroupName: any } {
    return {
        render: vi.fn(),
        getShortResourceTypeName: vi.fn().mockReturnValue('acr'),
        getResourceName: vi.fn().mockReturnValue(resourceName),
        getResourceGroupName: vi.fn().mockReturnValue(resourceGroupName),
    } as any;
}

function makeResource(type: string, name: string, ring = 'staging', region = 'eastasia'): Resource {
    return {
        name,
        type,
        ring: ring as any,
        region: region as any,
        project: 'merlintest',
        dependencies: [],
        config: {},
        exports: {},
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AzureManagedIdentityAuthProvider', () => {
    let provider: AzureManagedIdentityAuthProvider;

    beforeEach(() => {
        provider = new AzureManagedIdentityAuthProvider();
        vi.restoreAllMocks();
    });

    it('name is AzureManagedIdentity', () => {
        expect(provider.name).toBe('AzureManagedIdentity');
    });

    it('throws when role arg is missing', async () => {
        const requestor = makeResource('AzureContainerApp', 'myaca');
        const prov = makeResource('AzureContainerRegistry', 'myacr');

        vi.spyOn(resourceModule, 'getRender').mockReturnValue(makeRender('mymyacrstgeasacr', 'merlintest-rg-stg-eas') as any);

        await expect(provider.apply(requestor, prov, {})).rejects.toThrow("'role' is required");
    });

    describe('scope: resource (default)', () => {
        beforeEach(() => {
            vi.spyOn(resourceModule, 'getRender').mockImplementation((type: string) => {
                if (type === 'AzureContainerApp') {
                    return makeRender('merlintest-alluneed-stg-eas', 'merlintest-rg-stg-eas') as any;
                }
                return makeRender('merlintestalluneedstgeasacr', 'merlintest-rg-stg-eas') as any;
            });
        });

        it('returns 3 commands: principal capture, scope capture, role assignment', async () => {
            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'AcrPull' });

            expect(cmds).toHaveLength(3);
        });

        it('step 1 captures principal ID via containerapp show --query identity.principalId', async () => {
            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'AcrPull' });

            const captureCmd = cmds[0];
            expect(captureCmd.envCapture).toMatch(/^MERLIN_MI_.*_PRINCIPAL_ID$/);
            expect(captureCmd.command).toBe('az');
            expect(captureCmd.args).toContain('containerapp');
            expect(captureCmd.args).toContain('show');
            expect(captureCmd.args).toContain('identity.principalId');
        });

        it('step 2 captures scope via acr show --query id', async () => {
            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'AcrPull' });

            const scopeCmd = cmds[1];
            expect(scopeCmd.envCapture).toMatch(/^MERLIN_MI_.*_SCOPE$/);
            expect(scopeCmd.command).toBe('az');
            expect(scopeCmd.args).toContain('acr');
            expect(scopeCmd.args).toContain('show');
            expect(scopeCmd.args).toContain('id');
        });

        it('step 3 runs az role assignment create with captured var references', async () => {
            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'AcrPull' });

            const principalVar = cmds[0].envCapture!;
            const scopeVar     = cmds[1].envCapture!;
            const roleCmd      = cmds[2];

            expect(roleCmd.command).toBe('az');
            expect(roleCmd.args).toContain('role');
            expect(roleCmd.args).toContain('assignment');
            expect(roleCmd.args).toContain('create');
            expect(roleCmd.args).toContain('AcrPull');
            expect(roleCmd.args).toContain(`$${principalVar}`);
            expect(roleCmd.args).toContain(`$${scopeVar}`);
            // Must include --assignee-principal-type for reliability in automation
            expect(roleCmd.args).toContain('--assignee-principal-type');
            expect(roleCmd.args).toContain('ServicePrincipal');
        });

        it('no command has fileContent or envCapture on the role assignment step', async () => {
            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'AcrPull' });

            expect(cmds[2].envCapture).toBeUndefined();
            expect(cmds[2].fileContent).toBeUndefined();
        });
    });

    describe('scope: resourceGroup', () => {
        it('step 2 captures scope via az group show --query id', async () => {
            vi.spyOn(resourceModule, 'getRender').mockImplementation((type: string) => {
                if (type === 'AzureContainerApp') {
                    return makeRender('merlintest-alluneed-stg-eas', 'merlintest-rg-stg-eas') as any;
                }
                return makeRender('merlintestalluneedstgeasacr', 'merlintest-rg-stg-eas') as any;
            });

            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'Contributor', scope: 'resourceGroup' });

            const scopeCmd = cmds[1];
            expect(scopeCmd.args).toContain('group');
            expect(scopeCmd.args).toContain('show');
            expect(scopeCmd.args).toContain('--name');
            expect(scopeCmd.args).toContain('merlintest-rg-stg-eas');
        });
    });

    describe('scope: subscription', () => {
        it('step 2 captures scope via az account show --query id', async () => {
            vi.spyOn(resourceModule, 'getRender').mockImplementation((type: string) => {
                if (type === 'AzureContainerApp') {
                    return makeRender('merlintest-alluneed-stg-eas', 'merlintest-rg-stg-eas') as any;
                }
                return makeRender('merlintestalluneedstgeasacr', 'merlintest-rg-stg-eas') as any;
            });

            const requestor = makeResource('AzureContainerApp', 'alluneed');
            const prov      = makeResource('AzureContainerRegistry', 'alluneed');

            const cmds = await provider.apply(requestor, prov, { role: 'Owner', scope: 'subscription' });

            const scopeCmd = cmds[1];
            expect(scopeCmd.args).toContain('account');
            expect(scopeCmd.args).toContain('show');
            // No --name for subscription scope
            expect(scopeCmd.args).not.toContain('--name');
        });
    });

    describe('unknown resource type falls back to az resource show', () => {
        it('uses az resource show for unrecognised provider type', async () => {
            vi.spyOn(resourceModule, 'getRender').mockImplementation((type: string) => {
                if (type === 'AzureContainerApp') {
                    return makeRender('my-aca', 'my-rg') as any;
                }
                // Unknown type
                return makeRender('my-custom-resource', 'my-rg') as any;
            });

            const requestor = makeResource('AzureContainerApp', 'myapp');
            const prov      = makeResource('SomeUnknownType', 'myresource');

            const cmds = await provider.apply(requestor, prov, { role: 'Reader', scope: 'resource' });

            const scopeCmd = cmds[1];
            expect(scopeCmd.args).toContain('resource');
            expect(scopeCmd.args).toContain('show');
            expect(scopeCmd.args).toContain('--resource-type');
        });
    });

    describe('principal variable naming is deterministic', () => {
        it('two different requestors produce different principal var names', async () => {
            const mockRenderA = makeRender('merlintest-app-a-stg-eas', 'merlintest-rg-stg-eas');
            const mockRenderB = makeRender('merlintest-app-b-stg-eas', 'merlintest-rg-stg-eas');
            const mockRenderAcr = makeRender('merlintestappastgeasacr', 'merlintest-rg-stg-eas');

            const requestorA = makeResource('AzureContainerApp', 'app-a');
            const requestorB = makeResource('AzureContainerApp', 'app-b');
            const prov       = makeResource('AzureContainerRegistry', 'myacr');

            vi.spyOn(resourceModule, 'getRender').mockReturnValue(mockRenderAcr as any);

            vi.spyOn(resourceModule, 'getRender')
                .mockImplementationOnce(() => mockRenderA as any)
                .mockImplementation(() => mockRenderAcr as any);
            const cmdsA = await provider.apply(requestorA, prov, { role: 'AcrPull' });

            vi.spyOn(resourceModule, 'getRender')
                .mockImplementationOnce(() => mockRenderB as any)
                .mockImplementation(() => mockRenderAcr as any);
            const cmdsB = await provider.apply(requestorB, prov, { role: 'AcrPull' });

            expect(cmdsA[0].envCapture).not.toBe(cmdsB[0].envCapture);
        });
    });
});
