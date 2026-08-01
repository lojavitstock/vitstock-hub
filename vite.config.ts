import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/evolution-api': {
        target: 'http://147.15.34.119:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/evolution-api/, ''),
      },
    },
  },
});
