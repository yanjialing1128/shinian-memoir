import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    exclude: ['work/**', 'outputs/**', 'node_modules/**', 'dist/**'],
  },
});