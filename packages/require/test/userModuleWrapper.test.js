import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAllCaches, require as jscadRequire, requireCache, setUserModuleWrapper } from '../src/require.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'

const ROOT = 'http://project.local/'
const MODELING = 'http://bundles.test/modeling.js'
const FLUENT = 'http://bundles.test/fluent.js'
const files = {
  [MODELING]: 'module.exports = { primitives: { cube: () => "cube" } }',
  [FLUENT]: 'module.exports = { modeling: require("@jscad/modeling") }',
}
const readFile = (path) => {
  if (path in files) return files[path]
  throw new Error(`not found ${path}`)
}
const wrap = (name, exports) => ({ ...exports, wrappedAs: name })
const project = (url, script) => jscadRequire({ url, script }, null, readFile, ROOT, ROOT)

beforeEach(() => {
  requireCache.bundleAlias['@jscad/modeling'] = MODELING
  requireCache.bundleAlias['@jbroll/jscad-fluent'] = FLUENT
  setUserModuleWrapper(wrap)
})

afterEach(() => {
  delete requireCache.bundleAlias['@jscad/modeling']
  delete requireCache.bundleAlias['@jbroll/jscad-fluent']
  setUserModuleWrapper(null)
  clearAllCaches()
  moduleResolver.clearCache()
})

describe('user module wrapper', () => {
  it('gives a project file the wrapped copy, the same one on a cache hit', () => {
    const a = project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }')
    const b = project(`${ROOT}b.js`, 'module.exports = { m: require("@jscad/modeling") }')
    expect(a.m.wrappedAs).toBe('@jscad/modeling')
    expect(b.m).toBe(a.m)
  })

  it('gives a library bundle the real object', () => {
    const { fluent } = project(`${ROOT}c.js`, 'module.exports = { fluent: require("@jbroll/jscad-fluent") }')
    expect(fluent.wrappedAs).toBe('@jbroll/jscad-fluent')
    expect(fluent.modeling.wrappedAs).toBeUndefined()
    expect(fluent.modeling.primitives.cube()).toBe('cube')
  })

  it('gives a .scad caller the real object', () => {
    const { m } = project(`${ROOT}part.scad`, 'module.exports = { m: require("@jscad/modeling") }')
    expect(m.wrappedAs).toBeUndefined()
  })

  it('gives a base-less caller the real object, which is what the cache holds', () => {
    project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }')
    const real = jscadRequire('@jscad/modeling', null, readFile)
    expect(real.wrappedAs).toBeUndefined()
    expect(real.primitives.cube()).toBe('cube')
  })

  it('hands jscad-text to the wrapper too', () => {
    files['http://bundles.test/text.js'] = 'module.exports = { text2d: () => null }'
    requireCache.bundleAlias['@jscadui/jscad-text'] = 'http://bundles.test/text.js'
    const { t } = project(`${ROOT}a.js`, 'module.exports = { t: require("@jscadui/jscad-text") }')
    delete requireCache.bundleAlias['@jscadui/jscad-text']
    expect(t.wrappedAs).toBe('@jscadui/jscad-text')
  })

  it('passes everything through with no wrapper registered', () => {
    setUserModuleWrapper(null)
    expect(project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }').m.wrappedAs).toBeUndefined()
  })

  it('falls back to the real exports when the wrapper throws', () => {
    setUserModuleWrapper(() => { throw new Error('wrapper bug') })
    const { m } = project(`${ROOT}a.js`, 'module.exports = { m: require("@jscad/modeling") }')
    expect(m.wrappedAs).toBeUndefined()
    expect(m.primitives.cube()).toBe('cube')
  })
})

describe('wrapRequire on the given source', () => {
  const HELPER = `${ROOT}helper.js`

  beforeEach(() => {
    files[HELPER] = 'module.exports = { n: 1, inner: require("./leaf.js") }'
    files[`${ROOT}leaf.js`] = 'module.exports = { leaf: true }'
  })

  afterEach(() => {
    delete files[HELPER]
    delete files[`${ROOT}leaf.js`]
  })

  it("wraps only that module's own require", () => {
    const seen = []
    const wrapRequire = (req) => (spec) => {
      seen.push(spec)
      return { ...req(spec), wrapped: true }
    }
    const out = jscadRequire({ url: `${ROOT}__run__.js`, script: 'module.exports = require("./helper.js")', wrapRequire }, null, readFile, ROOT, ROOT)
    expect(out).toMatchObject({ n: 1, wrapped: true, inner: { leaf: true } })
    expect(out.inner.wrapped).toBeUndefined()
    expect(seen).toEqual(['./helper.js'])
  })
})
