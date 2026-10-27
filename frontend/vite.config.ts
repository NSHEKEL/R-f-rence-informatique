import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Older Android WebViews still run in the field: keep the bundle readable
  // by them, otherwise the phone shows a blank page.
  build: {
    target: ['es2017', 'chrome64', 'safari12'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
