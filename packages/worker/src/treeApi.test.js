import { describe, it, expect, vi, afterEach } from 'vitest'

const { requireMock, cache } = vi.hoisted(() => ({
  requireMock: vi.fn(),
  cache: { bundleAlias: {} },
}))

vi.mock('@jscadui/require', () => ({
  require: requireMock,
  readFileWeb: () => {},
  requireCache: cache,
}))

const { loadBoundEvaluate } = await import('./treeApi.js')

afterEach(() => {
  delete cache.bundleAlias['@jscad/modeling']
  requireMock.mockReset()
  vi.restoreAllMocks()
})

describe('loadBoundEvaluate', () => {
  it('returns undefined without warning when no bundle url is present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(loadBoundEvaluate()).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns undefined when the modeling bundle fails to load', () => {
    cache.bundleAlias['@jscad/modeling'] = 'blob:modeling'
    requireMock.mockImplementation(() => { throw new Error('bad bundle') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(loadBoundEvaluate()).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('returns the bundle evaluate when the modeling bundle loads', () => {
    cache.bundleAlias['@jscad/modeling'] = 'blob:modeling'
    const evaluate = () => {}
    requireMock.mockReturnValue({ evaluate })

    expect(loadBoundEvaluate()).toBe(evaluate)
  })
})
