import { defineConfig } from 'tsup';

export default defineConfig([
    // CLI build
    {
        entry: ['src/merlin.ts'],
        format: ['esm'],
        target: 'node20',
        outDir: 'dist',
        clean: true,
        sourcemap: true,
        shims: true,
        banner: {
            js: '#!/usr/bin/env node',
        },
        // Copy templates after build
        async onSuccess() {
            const { copyFile, mkdir } = await import('fs/promises');
            const path = await import('path');

            // Create templates directory
            const templatesDir = path.join('dist', 'compiler', 'templates');
            await mkdir(templatesDir, { recursive: true });

            // Copy template file
            const srcTemplate = path.join('src', 'compiler', 'templates', 'deploy-script.ts.template');
            const destTemplate = path.join(templatesDir, 'deploy-script.ts.template');
            await copyFile(srcTemplate, destTemplate);

            console.log('✓ Templates copied to dist/compiler/templates/');
        },
    },
    // Library build (runtime exports for generated code)
    {
        entry: ['src/runtime.ts', 'src/init.ts'],
        format: ['esm'],
        target: 'node20',
        outDir: 'dist',
        clean: false, // Don't clean - we want both CLI and library
        sourcemap: true,
        dts: true, // Generate TypeScript declarations
    }
]);
