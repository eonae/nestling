import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig({
    plugins: [react()],
    root: 'src/static',
    build: {
        outDir: '../../dist/static',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/static/index.html')
            }
        }
    },
    server: {
        port: 3333,
        open: true
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src/static/src'),
            '@core': resolve(__dirname, 'src/static/src/core'),
            '@components': resolve(__dirname, 'src/static/src/components'),
            '@hooks': resolve(__dirname, 'src/static/src/hooks'),
            '@types': resolve(__dirname, 'src/static/src/types')
        }
    }
});
