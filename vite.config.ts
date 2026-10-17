import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative URLs, so the same build works at a domain root (Vercel) and under /toll-jump/ (GitHub Pages)
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true, port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
