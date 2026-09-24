import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'lib/**/*.test.ts',
      'lib/**/*.spec.ts',
      'app/**/*.test.ts',
      'app/**/*.spec.ts',
      'hooks/**/*.test.ts',
      'hooks/**/*.test.tsx',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
