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
})
