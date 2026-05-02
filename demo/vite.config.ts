import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'index.html'),
    },
  },
})
