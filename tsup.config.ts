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
    },
    // Library build (runtime exports for generated code)
    {
        entry: ['src/runtime.ts', 'src/init.ts', 'src/deployer.ts'],
        format: ['esm'],
        target: 'node20',
        outDir: 'dist',
        clean: false, // Don't clean - we want both CLI and library
        sourcemap: true,
        dts: true, // Generate TypeScript declarations
    }
]);
