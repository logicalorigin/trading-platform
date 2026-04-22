import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/')) {
            return 'recharts-core';
          }
          if (id.includes('/node_modules/victory-vendor/')) {
            return 'victory-vendor';
          }
          if (id.includes('/node_modules/d3-')) {
            return 'd3-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
