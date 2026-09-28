import { describe, expect, it, vi } from 'vitest'

// Isolated in its own file: mocking @jscadui/require's bundleAlias/require here
// would change modelingReady()'s behavior for option-warnings.test.js's
// synchronous fluent-method assertions.
vi.mock('@jscadui/require', async () => {
  const actual = await vi.importActual('@jscadui/require')
  return {
    ...actual,
    requireCache: { bundleAlias: { '@jscad/modeling': 'modeling-url' } },
    require: () => ({ ready: Promise.reject(new Error('wasm load failed')) }),
  }
})

const { installOptionWarnings } = await import('../src_frame/optionWarnings.js')

describe('frame option warnings: modeling-ready wait', () => {
  it('never leaves a rejected modeling-ready promise as an unhandled rejection', async () => {
    const onUnhandledRejection = vi.fn()
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      let wrapper
      installOptionWarnings({ setUserModuleWrapper: (fn) => { wrapper = fn }, setRunWarnings: () => {} })
      wrapper('@jbroll/jscad-fluent', { circle: () => ({}) })
      await new Promise((resolve) => setImmediate(resolve))
      expect(onUnhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})
