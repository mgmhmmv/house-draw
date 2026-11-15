import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Worker runs separately (`npm run dev:api`, port 8787) and Vite
// forwards /api to it, so the browser sees one origin just like in production.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
