import { describe, expect, test } from 'vitest'
import { getBundles } from './bundles.js'

const toUrl = path => new URL(path, 'http://viewer.test/').toString()
const CDN = 'https://cdn.jsdelivr.net/npm/@jbroll/jscad-anchors@0.1/dist/jscad-anchors.cjs'
const LOCAL = 'http://127.0.0.1:9000/__studio/packages/@jbroll/jscad-anchors/dist/jscad-anchors.cjs'

describe('getBundles', () => {
  test('jscad engine: modeling is the local bundle, anchors rides the CDN', () => {
    const b = getBundles({ engine: 'jscad', toUrl })
    expect(b['@jscad/modeling']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
    expect(b['@jbroll/jscad-anchors']).toBe(CDN)
    expect(b['@jscad/modeling-for-anchors']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
    expect(b['@jscad/modeling-for-manifold']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
    expect(b['@jscad/io']).toBe('http://viewer.test/build/bundle.jscad_io.js')
    expect(b['@jscadui/model-tools']).toBe('http://viewer.test/build/bundle.model-tools.js')
    expect(b['@jscad/csg']).toBe('http://viewer.test/build/bundle.V1_api.js')
    expect(b['@jscadui/params-core']).toBe('http://viewer.test/build/bundle.params_core.js')
    expect(b['@jscadui/jscad-text']).toBe('http://viewer.test/build/bundle.jscad_text.js')
  })

  test('manifold engine: the anchors build wraps the manifold bundle', () => {
    const b = getBundles({ engine: 'manifold', toUrl })
    expect(b['@jscad/modeling']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
    expect(b['@jscad/modeling-for-anchors']).toBe('http://viewer.test/build/bundle.manifold_modeling.js')
    expect(b['@jscad/modeling-for-manifold']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
  })

  test('overrides replace single names without touching the other', () => {
    const b = getBundles({ engine: 'jscad', toUrl, overrides: { '@jbroll/jscad-anchors': LOCAL } })
    expect(b['@jbroll/jscad-anchors']).toBe(LOCAL)
    expect(b['@jscad/modeling']).toBe('http://viewer.test/build/bundle.jscad_modeling.js')
    const c = getBundles({ engine: 'jscad', toUrl, overrides: { '@jscad/modeling': LOCAL } })
    expect(c['@jscad/modeling']).toBe(LOCAL)
  })

  test('other overrides pass through', () => {
    const fluent = 'http://127.0.0.1:9000/__studio/packages/@jbroll/jscad-fluent/dist/jscad-fluent.umd.cjs'
    const b = getBundles({ engine: 'jscad', toUrl, overrides: { '@jbroll/jscad-fluent': fluent } })
    expect(b['@jbroll/jscad-fluent']).toBe(fluent)
  })
})
