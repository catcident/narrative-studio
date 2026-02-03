import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  define: {
    // 환경변수 주입 (로컬 .env 및 Railway)
    'import.meta.env.OPENROUTER_API_KEY': JSON.stringify(process.env.OPENROUTER_API_KEY || ''),
  },
  server: {
    proxy: {
      // 개발 시 /api 요청을 백엔드 서버로 프록시
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
