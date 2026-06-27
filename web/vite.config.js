import { defineConfig } from 'vite';

const backendUrl = process.env.MIO_BACKEND_URL
  || `http://localhost:${process.env.MIO_HTTP_PORT || 3000}`;
const backendWsUrl = backendUrl.replace(/^http/, 'ws');

export default defineConfig({
  root: '.',
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsUrl,
        ws: true,
        changeOrigin: true,
      },
      '^/(health|status|avatar|onboarding|search|notify|admin)': {
        target: backendUrl,
        changeOrigin: true,
      }
    },
  },
});
