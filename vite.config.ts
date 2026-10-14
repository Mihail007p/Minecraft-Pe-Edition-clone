import { defineConfig } from 'vite';

// Относительный base — чтобы сборка работала и на GitHub Pages, и в Capacitor (file://).
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700, // three.js — один большой модуль, это ожидаемо
  },
});
