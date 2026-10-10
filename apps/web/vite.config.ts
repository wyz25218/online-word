import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 业务 HTTP API：/api → NestJS server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 协同 WebSocket：/collab → Hocuspocus 网关
      '/collab': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // 对象存储同源代理（T2.1）：签名 URL 与公读 URL 统一走 /s3proxy 前缀。
      // changeOrigin 把 Host 还原为 localhost:9000，SigV4 预签名验签才通过；
      // 同源化后浏览器直传 PUT / <img> 加载均无 CORS 问题。生产由 nginx 同名 location 反代。
      '/s3proxy': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/s3proxy/, ''),
      },
    },
  },
})
