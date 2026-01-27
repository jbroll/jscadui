import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.js'],
    exclude: ['node_modules', 'build', 'build_dev', 'jscad'],
    testTimeout: 30000,
  },
})
