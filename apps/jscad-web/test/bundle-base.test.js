import { describe, it, expect } from 'vitest'
import { bundleFileUrl } from '../src_bundle/bundleBase.js'

describe('bundleFileUrl', () => {
  it('resolves against the worker location in a normal worker', () => {
    const scope = { location: { href: 'http://localhost:5120/build/bundle.worker.js' } }
    expect(bundleFileUrl('./manifold.wasm', scope)).toBe('http://localhost:5120/build/manifold.wasm')
  })

  it('resolves against the injected base in a blob worker', () => {
    const scope = {
      __BUNDLE_BASE__: 'https://jscad-run.rkroll.com/build/',
      location: { href: 'blob:null/6f1c8f4e-0f1a-4b2a-9a1f-2f1b3c4d5e6f' },
    }
    expect(bundleFileUrl('./manifold.wasm', scope)).toBe('https://jscad-run.rkroll.com/build/manifold.wasm')
  })

  it('throws rather than resolving against an opaque blob base', () => {
    const scope = { location: { href: 'blob:null/6f1c8f4e-0f1a-4b2a-9a1f-2f1b3c4d5e6f' } }
    expect(() => bundleFileUrl('./manifold.wasm', scope)).toThrow(/bundle base/)
  })

  it('prefers the injected base over the location', () => {
    const scope = {
      __BUNDLE_BASE__: 'https://jscad-run.rkroll.com/build/',
      location: { href: 'http://localhost:5120/build/bundle.worker.js' },
    }
    expect(bundleFileUrl('./manifold.wasm', scope)).toBe('https://jscad-run.rkroll.com/build/manifold.wasm')
  })
})
