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
    // WSL2 挂载的 Windows 盘(/mnt/*)收不到 inotify 事件,必须轮询才能热更新
    watch: {
      usePolling: true,
      interval: 300,
    },
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
      '^/(health|status|avatar|voice|chat|mod|persona|analytics|search|memories|user-profile|proactive|notify|admin|character|characters)': {
        target: backendUrl,
        changeOrigin: true,
      }
    },
  },
});
