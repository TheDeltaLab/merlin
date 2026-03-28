import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { loadProjectConfig, applyProjectDefaults, discoverProjectConfigs } from '../projectConfig.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('projectConfig', () => {
    const tmpDir = path.join(process.cwd(), '.test-tmp-project-config');

    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('loadProjectConfig', () => {
        it('returns undefined when no merlin.yml exists', () => {
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeUndefined();
        });

        it('loads project, ring, and region from merlin.yml', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: merlin
ring:
  - test
  - staging
region:
  - koreacentral
  - eastasia
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeDefined();
            expect(result!.project).toBe('merlin');
            expect(result!.ring).toEqual(['test', 'staging']);
            expect(result!.region).toEqual(['koreacentral', 'eastasia']);
        });

        it('loads a single ring value', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: myproject
ring: test
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeDefined();
            expect(result!.ring).toBe('test');
        });

        it('loads authProvider as string', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: merlin
ring: staging
authProvider: AzureEntraID
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeDefined();
            expect(result!.authProvider).toBe('AzureEntraID');
        });

        it('loads authProvider as object', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: merlin
ring: staging
authProvider:
  name: AzureEntraID
  tenantId: abc
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeDefined();
            expect(result!.authProvider).toEqual({ name: 'AzureEntraID', tenantId: 'abc' });
        });

        it('returns undefined for a regular resource YAML (has type field)', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
name: my-resource
type: KubernetesDeployment
ring: test
defaultConfig:
  namespace: default
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeUndefined();
        });

        it('returns undefined for invalid YAML', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
{{{invalid yaml
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeUndefined();
        });

        it('returns project config with only partial fields', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: myapp
`);
            const result = loadProjectConfig(tmpDir);
            expect(result).toBeDefined();
            expect(result!.project).toBe('myapp');
            expect(result!.ring).toBeUndefined();
            expect(result!.region).toBeUndefined();
        });
    });

    describe('applyProjectDefaults', () => {
        it('fills in missing fields from project config', () => {
            const data = { name: 'myapp', type: 'KubernetesDeployment' } as Record<string, unknown>;
            const projectConfig = { project: 'merlin', ring: ['test', 'staging'] as string[] };

            const result = applyProjectDefaults(data, projectConfig);

            expect(result.name).toBe('myapp');
            expect(result.type).toBe('KubernetesDeployment');
            expect(result.project).toBe('merlin');
            expect(result.ring).toEqual(['test', 'staging']);
        });

        it('does not override resource-level fields', () => {
            const data = {
                name: 'myapp',
                type: 'KubernetesDeployment',
                project: 'custom-project',
                ring: 'production',
            } as Record<string, unknown>;
            const projectConfig = { project: 'merlin', ring: ['test', 'staging'] as string[] };

            const result = applyProjectDefaults(data, projectConfig);

            expect(result.project).toBe('custom-project');
            expect(result.ring).toBe('production');
        });

        it('applies region default when resource has no region', () => {
            const data = { name: 'myapp', type: 'KubernetesDeployment' } as Record<string, unknown>;
            const projectConfig = { region: ['koreacentral', 'eastasia'] as string[] };

            const result = applyProjectDefaults(data, projectConfig);

            expect(result.region).toEqual(['koreacentral', 'eastasia']);
        });

        it('applies authProvider default', () => {
            const data = { name: 'myapp', type: 'KubernetesDeployment' } as Record<string, unknown>;
            const projectConfig = { authProvider: 'AzureEntraID' };

            const result = applyProjectDefaults(data, projectConfig);

            expect(result.authProvider).toBe('AzureEntraID');
        });
    });

    describe('discoverProjectConfigs', () => {
        it('returns empty map for directories without merlin.yml', () => {
            const result = discoverProjectConfigs([tmpDir]);
            expect(result.size).toBe(0);
        });

        it('discovers merlin.yml in a directory', () => {
            fs.writeFileSync(path.join(tmpDir, 'merlin.yml'), `
project: merlin
ring: [test, staging]
`);
            const result = discoverProjectConfigs([tmpDir]);
            expect(result.size).toBe(1);
            expect(result.get(tmpDir)).toBeDefined();
            expect(result.get(tmpDir)!.project).toBe('merlin');
        });
    });
});
