import { defineConfig } from 'vite';

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
      // 代理 API 请求到后端开发服务器
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 代理 WebSocket 请求
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
      // 非 /api 前缀的后端接口（优先级低于 /api，但路径不冲突）
      '^/(health|status|avatar|onboarding|search|notify|admin)': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    },
  },
});
