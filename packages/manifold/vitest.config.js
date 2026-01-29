import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // Map the internal alias to the actual @jscad/modeling package
      '@jscad/modeling-core': '@jscad/modeling'
    }
  }
})
