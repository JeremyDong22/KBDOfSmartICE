// Version: 2.1 - Disabled source maps for production security
// Uses standard Vite multi-page setup with root HTML files

import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@services': path.resolve(__dirname, './src/services'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,  // Disabled for production security
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'main.html'),
      },
      output: {
        manualChunks: {
          'vendor': ['leaflet', '@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: true,  // 允许局域网访问
    open: '/',
  },
});
