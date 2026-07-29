import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: '../../dist/web',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/auth': 'http://localhost:3000',
      '/api/v1': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/openapi.json': 'http://localhost:3000',
    },
  },
});
