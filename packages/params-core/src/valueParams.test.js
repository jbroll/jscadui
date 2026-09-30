import { describe, expect, it } from 'vitest'
import { createParamsProxy, createProxyState } from './createParamsProxy.js'
import { paramsFromValues, withProjectMains, withValueParams } from './valueParams.js'

const sliderModel = (params) => {
  params.width = { type: 'slider', default: 60, min: 10, max: 100 }
  params.height = { type: 'slider', default: 20 }
  return { width: params.width, height: params.height }
}

describe('paramsFromValues', () => {
  it('lets the given values win over the definitions main() assigns', () => {
    expect(sliderModel(paramsFromValues({ width: 30 }))).toEqual({ width: 30, height: 20 })
  })

  it('gives every parameter its default with no values', () => {
    expect(sliderModel(paramsFromValues())).toEqual({ width: 60, height: 20 })
  })

  it('reaches nested parts by their dotted path', () => {
    const model = (params) => {
      params.lid.height = { type: 'slider', default: 5 }
      return params.lid.height
    }
    expect(model(paramsFromValues({ lid: { height: 8 } }))).toBe(8)
  })

  it('keeps an array value whole', () => {
    const model = (params) => {
      params.size = { default: [1, 2, 3] }
      return params.size
    }
    expect(model(paramsFromValues({ size: [4, 5, 6] }))).toEqual([4, 5, 6])
  })
})

describe('withValueParams', () => {
  it('runs main with a params proxy built from a plain object, or from nothing', () => {
    const main = withValueParams(sliderModel)
    expect(main({ width: 30 })).toEqual({ width: 30, height: 20 })
    expect(main()).toEqual({ width: 60, height: 20 })
  })

  it('passes a params proxy through as it is', () => {
    const seen = []
    const main = withValueParams((params) => seen.push(params))
    const proxy = createParamsProxy(createProxyState())
    main(proxy)
    expect(seen[0]).toBe(proxy)
  })
})

describe('withProjectMains', () => {
  const modules = {
    './main.js': { main: sliderModel, other: 1 },
    '@jscad/modeling': { main: sliderModel },
    './fn.js': Object.assign(sliderModel.bind(null), { extra: 2 }),
  }
  modules['./main.js'].default = modules['./main.js']
  const require = withProjectMains((spec) => modules[spec])

  it("wraps a project module's main and leaves the cached exports alone", () => {
    const exported = require('./main.js')
    expect(exported.main({ width: 30 })).toEqual({ width: 30, height: 20 })
    expect(exported.other).toBe(1)
    expect(exported.default).toBe(exported)
    expect(modules['./main.js'].main).toBe(sliderModel)
  })

  it('wraps a project module that exports main itself', () => {
    const exported = require('./fn.js')
    expect(exported({ width: 30 })).toEqual({ width: 30, height: 20 })
    expect(exported.extra).toBe(2)
  })

  it('leaves packages alone', () => {
    expect(require('@jscad/modeling')).toBe(modules['@jscad/modeling'])
  })
})
