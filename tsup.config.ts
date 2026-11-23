import { defineConfig } from 'tsup';

export default defineConfig([
    {
        // One entry per part (package.json "exports"); ESM shares code
        // between them in chunks, so one class is one class across parts.
        entry: {
            index: 'src/index.ts',
            graph: 'src/graph.ts',
            rect: 'src/rect.ts',
            modelview: 'src/modelview.ts',
            workflow: 'src/workflow.ts',
            widget: 'src/widget.ts',
            netview: 'src/netview.ts',
            chart: 'src/chart.ts',
            records: 'src/records.ts',
            iso: 'src/iso.ts'
        },
        format: ['esm', 'cjs'],
        splitting: true,
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
