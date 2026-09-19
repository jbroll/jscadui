/**
 * Fluent in the production worker bundles.
 * Exercises the REAL built bundle.jscad-fluent.js with real fluent sources:
 * a cube renders entities, and both classic params paths yield defs.
 * Requires a prior `node build.js` so build/build/bundle.jscad-fluent.<hash>.js exists.
 *
 * The bundle is loaded the way the worker loads it: source text evaled as
 * CJS with a require shim for its externals (the worker's bundle aliases
 * provide @jbroll/jscad-anchors and @jscad/modeling at runtime; here the
 * shim provides the local anchors dist and real modeling). Plain Node
 * require() of the .js artifact does not work under "type": "module".
 */
import { describe, expect, it } from 'vitest'
import Module from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modeling = nodeRequire('@jscad/modeling')
const { measure } = nodeRequire('@jscadui/model-tools')
// Import the pure params module directly: the package entry (worker.js)
// registers worker-global listeners at import time (no `self` in Node).
const { getParameterDefinitionsFromSource } = await import('@jscadui/worker/src/getParameterDefinitionsFromSource.js')

// The anchors dist requires the runtime-only '@jscad/modeling-for-anchors'
// alias; map it to real modeling the way the worker alias does.
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@jscad/modeling-for-anchors') return modeling
  return origLoad.call(this, request, parent, isMain)
}

const anchorsDist = join(__dirname, '..', '..', '..', '..', 'jscad-anchors', 'dist', 'jscad-anchors.cjs')

const findFluentBundle = () => {
  const dir = join(__dirname, '..', 'build', 'build')
  if (!existsSync(dir)) return null
  // Production builds content-hash leaves (bundle.jscad-fluent.<hash>.js);
  // dev builds keep the plain name. Ignore stale double-hashed copies.
  const dev = join(dir, 'bundle.jscad-fluent.js')
  if (existsSync(dev)) return dev
  const hashed = readdirSync(dir).filter((f) => /^bundle\.jscad-fluent\.[0-9a-f]{8}\.js$/.test(f)).sort()
  return hashed.length > 0 ? join(dir, hashed[0]) : null
}

// Eval the bundle source as CJS, exactly how the worker's require() evals
// bundle-aliased sources (no transform; require/module/exports in scope).
const loadFluentBundle = (bundlePath) => {
  const source = readFileSync(bundlePath, 'utf8')
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-anchors') return nodeRequire(anchorsDist)
    if (name === '@jscad/modeling' || name === '@jscad/modeling-for-anchors') return modeling
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  return module.exports
}

const runFluentSource = (source, fluentBundle) => {
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-fluent') return fluentBundle
    if (name === '@jscad/modeling') return modeling
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  const main = module.exports.main ?? module.exports
  const out = main({})
  return { exports: module.exports, geometry: Array.isArray(out) ? out : [out] }
}

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

const CUBE_PARAMS_BLOCK = `/** @jscad-params
size = 20 // Size
}*/
const jf = require('@jbroll/jscad-fluent')
function main(p) { return [jf.cube({ size: p.size ?? 20 })] }
module.exports = { main }`

const CUBE_LEGACY_PARAMS = `const jf = require('@jbroll/jscad-fluent')
function getParameterDefinitions() { return [{ name: 'size', type: 'int', initial: 20, caption: 'Size' }] }
function main(p) { return [jf.cube({ size: p.size ?? 20 })] }
module.exports = { main, getParameterDefinitions }`

describe('fluent worker bundle', () => {
  it('bundle artifact exists (run node build.js first)', () => {
    expect(findFluentBundle(), 'missing bundle.jscad-fluent.js: run node build.js').not.toBeNull()
  })

  it('a fluent cube renders one entity with ~8000 volume', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    expect(typeof fluentBundle.cube).toBe('function')
    const { geometry } = runFluentSource(CUBE, fluentBundle)
    expect(geometry).toHaveLength(1)
    const { volume } = measure(geometry.length === 1 ? geometry[0] : geometry, {})
    expect(volume).toBeGreaterThan(7900)
    expect(volume).toBeLessThan(8100)
  })

  it('a fluent model with an @jscad-params block yields defs through the existing params path', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    const { exports } = runFluentSource(CUBE_PARAMS_BLOCK, fluentBundle)
    expect(typeof exports.main).toBe('function')
    const defs = getParameterDefinitionsFromSource(CUBE_PARAMS_BLOCK)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({ name: 'size', initial: 20 })
  })

  it('a fluent model with a getParameterDefinitions export yields defs', () => {
    const fluentBundle = loadFluentBundle(findFluentBundle())
    const { exports } = runFluentSource(CUBE_LEGACY_PARAMS, fluentBundle)
    expect(typeof exports.getParameterDefinitions).toBe('function')
    expect(exports.getParameterDefinitions()).toMatchObject([{ name: 'size' }])
  })
})
