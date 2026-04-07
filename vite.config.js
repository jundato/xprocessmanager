import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  server: {
    port: 1338,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:1337',
        changeOrigin: true,
      },
      '/ws/terminal': {
        target: 'http://127.0.0.1:1337',
        ws: true,
        changeOrigin: true,
        on: {
          error: () => {},
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
