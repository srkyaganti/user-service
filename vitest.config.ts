import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    isolate: true,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
        '**/generated/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@user-service/database': path.resolve(__dirname, 'packages/database/src'),
      '@user-service/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
})