import { defineConfig } from 'vitest/config'

// The eval fixtures run real geometry builds; the default 5s per-test timeout
// is too tight under full parallel load on a busy machine and times out the
// heavier reference models (pegboard, twisted-vase) spuriously.
export default defineConfig({ test: { testTimeout: 20000, hookTimeout: 30000 } })
