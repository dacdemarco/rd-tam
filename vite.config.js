import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: '../public',
  build: { outDir: '../dist/browser', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@huggingface/transformers'] },
});
