import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__test__/**/*.ts', 'src/**/__tests__/**/*.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__test__/**/*',
        'src/**/__tests__/**/*',
        'src/index.ts',
      ],
    },
  },
});
