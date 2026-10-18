// Why `view` refuses a part-name look-at: the app cannot map a typed param path
// to a geometry index, and this suite pins that against a real multi-part model
// so a future "just number the typed paths" fix cannot land silently wrong.
//
// `proxyState.types` is keyed by param path in the order the model *set*
// `_type` while building (`createParamsProxy.js`), not in the order `main()`
// returns geometry. `measure({parts})` numbers the returned array, and the car
// below returns one item per leaf — wheels and hubs per axle, three for the
// body — so the two orders have different lengths and different contents. The
// assertions below are the evidence, on the real example the design doc names.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { measure } from '@jscadui/model-tools/src/measure.js'
import { createParamsProxy, createProxyState } from '@jscadui/params-core'
import { createViewHandler } from '../src/aiView.js'

const here = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

// The example is written for the app's CommonJS example loader, so evaluate it
// the way that loader does with `@jscad/modeling` standing in for the engine.
const loadCar = () => {
  const source = readFileSync(join(here, '../examples/jscad/jscad-examples/02-hierarchical-car.example.js'), 'utf8')
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jscad/modeling') return nodeRequire('@jscad/modeling')
    throw new Error(`the example required ${name}`)
  }
  new Function('require', 'exports', 'module', source)(require, module.exports, module)
  return module.exports
}

// `main()` returns nested arrays; the worker flattens them before measuring, so
// this is the array `measure({parts: 'all'})` indexes.
const flatten = (value, out = []) => {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out)
    return out
  }
  out.push(value)
  return out
}

const carOf = () => {
  const state = createProxyState({}, new Set(), { mode: 'hierarchical' })
  const items = flatten(loadCar().main(createParamsProxy(state)))
  return { typedPaths: [...state.types.keys()], measured: measure(items, { parts: 'all' }).parts }
}

const near = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-6)
const centerOf = (parts, index) => parts.find((part) => part.part === String(index)).center

describe('part-name look-at provenance (real hierarchical car)', () => {
  it('cannot be numbered by typed-path insertion order: the counts differ', () => {
    const { typedPaths, measured } = carOf()

    // 11 typed paths ('', front, front.left, …, spoiler) against 13 geometry
    // items (each axle's rod plus two two-part wheels, plus the body's three).
    expect(typedPaths).toHaveLength(11)
    expect(measured).toHaveLength(13)
    expect(typedPaths).toContain('body')
  })

  it('resolves two named parts to the wrong items if numbered that way', () => {
    const { typedPaths, measured } = carOf()
    const at = (path) => centerOf(measured, typedPaths.indexOf(path))

    // The body block is built on the car's centre line at z = 4.5; insertion
    // index 7 is a rear-left wheel hub at x = -7 instead.
    expect(at('body')).toEqual([-7, -6, 0])
    expect(measured.some((part) => near(part.center, [0, 0, 4.5]))).toBe(true)

    // The cabin sits above the body at [-4, 0, 7.3]; its insertion index lands
    // on a rear-right tire.
    expect(at('body.cabin')).toEqual([-7, 6, 0])
    expect(measured.some((part) => near(part.center, [-4, 0, 7.3]))).toBe(true)
  })

  it('refuses the names the model itself declares, atomically', async () => {
    const { typedPaths } = carOf()
    expect(typedPaths).toContain('body.cabin')

    const render = async () => {
      throw new Error('the renderer must not run')
    }
    const view = createViewHandler({ getMesh: () => [{ type: 'mesh' }], noGeometry: async () => null, render })

    await expect(view({ views: [{ preset: 'top' }, { lookAt: 'body.cabin' }] })).rejects.toThrowError(/PartLookAtUnsupportedError/)
  })
})
