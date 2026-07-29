import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'path'

// FORGE Platform UI — Vite dev server + build.
// Dev server proxies /api to the Express control-plane (forge ui starts both).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      // Brand asset served by the Express control-plane (dev + prod).
      '/forge-logo.png': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
