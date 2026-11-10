import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: '../public',
  build: { outDir: '../dist/browser', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
  plugins: [{ name: 'analysis-only', transformIndexHtml: html => html.replace('<html lang="es" class="booting"', '<html lang="es" class="booting web"').replace('initial-scale=1"', 'initial-scale=1, maximum-scale=1"') }],
});
