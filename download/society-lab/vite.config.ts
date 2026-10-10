import { defineConfig } from 'vite';

export default defineConfig({
  // 部署在 Next.js public/game/ 下（沙箱发布与 gh-pages 均挂载该前缀）
  base: '/game/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 1024 * 64,
  },
  server: {
    host: '127.0.0.1',
    port: 5183,
  },
});
