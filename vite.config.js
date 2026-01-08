import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    root: 'src/tools/viz/static',
    build: {
        outDir: '../../../dist/viz',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/tools/viz/static/index.html')
            }
        }
    },
    server: {
        port: 3333,
        open: true
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src/tools/viz/static/src'),
            '@core': resolve(__dirname, 'src/tools/viz/static/src/core'),
            '@components': resolve(__dirname, 'src/tools/viz/static/src/components'),
            '@hooks': resolve(__dirname, 'src/tools/viz/static/src/hooks'),
            '@utils': resolve(__dirname, 'src/tools/viz/static/src/utils')
        }
    }
});
