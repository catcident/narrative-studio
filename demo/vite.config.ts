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
    // Railway에서 환경변수 주입
    'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(process.env.VITE_OPENROUTER_API_KEY || ''),
  },
})
