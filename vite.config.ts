import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/exif-scrubber/',
  build: {
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
