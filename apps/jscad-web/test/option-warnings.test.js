import { describe, expect, it, vi } from 'vitest'
import { installOptionWarnings } from '../src_frame/optionWarnings.js'

const install = () => {
  let wrapper
  let collector
  installOptionWarnings({
    setUserModuleWrapper: (fn) => { wrapper = fn },
    setRunWarnings: (c) => { collector = c },
  })
  return { wrapper, collector }
}

describe('frame option warnings', () => {
  it('checks modeling and the anchors alias against the modeling table', () => {
    const { wrapper, collector } = install()
    const roundedCuboid = vi.fn(() => 'solid')
    const api = { primitives: { roundedCuboid } }
    expect(wrapper('@jscad/modeling', api).primitives.roundedCuboid({ radius: 2 })).toBe('solid')
    wrapper('@jscad/modeling-for-anchors', api).primitives.roundedCuboid({ radius: 2 })
    expect(collector.list()).toEqual([{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }])
  })

  it('checks fluent factories under jf. names', () => {
    const { wrapper, collector } = install()
    wrapper('@jbroll/jscad-fluent', { cube: () => 'c' }).cube({ sise: 1 })
    expect(collector.list()).toEqual([{ fn: 'jf.cube', option: 'sise', suggestions: ['size'] }])
  })

  it('checks fluent methods on the classes behind the module', () => {
    const { wrapper, collector } = install()
    class Geom2 {
      extrudeLinear(options) { return options }
    }
    wrapper('@jbroll/jscad-fluent', { circle: () => new Geom2() })
    new Geom2().extrudeLinear({ hieght: 1 })
    expect(collector.list()).toEqual([{ fn: 'FluentGeom2.extrudeLinear', option: 'hieght', suggestions: ['height'] }])
  })
})
