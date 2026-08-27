import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: {index: 'src/index.ts'},
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        target: 'es2020'
    },
    {
        entry: {jsngraph: 'src/index.ts'},
        format: ['iife'],
        globalName: 'JSNGraph',
        outDir: 'dist',
        sourcemap: true,
        minify: true,
        target: 'es2020'
    }
]);
