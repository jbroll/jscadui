import { describe, it, expect } from 'vitest'
import { exportStlText } from './exportStlText.js'

describe('exportStlText', () => {
  it('computes facet normals from positions for an indexed quad', () => {
    const quad = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3])
    }
    const text = exportStlText([quad]).join('')
    const facetNormals = [...text.matchAll(/facet normal ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/g)]
    expect(facetNormals).toHaveLength(2)
    facetNormals.forEach(([, x, y, z]) => {
      expect(Number(x)).toBeCloseTo(0)
      expect(Number(y)).toBeCloseTo(0)
      expect(Number(z)).toBeCloseTo(1)
    })
  })

  it('ignores per-vertex normals that disagree with the winding', () => {
    const quad = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1])
    }
    const text = exportStlText([quad]).join('')
    const facetNormals = [...text.matchAll(/facet normal [-\d.e]+ [-\d.e]+ ([-\d.e]+)/g)]
    facetNormals.forEach(([, z]) => {
      expect(Number(z)).toBeCloseTo(1)
    })
  })

  it('skips a facet with an out-of-range index instead of emitting NaN', () => {
    const errors = []
    const origError = console.error
    console.error = (...args) => { errors.push(args.join(' ')) }
    try {
      const mesh = {
        vertices: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1, 5])
      }
      const text = exportStlText([mesh]).join('')
      expect(errors.length).toBeGreaterThan(0)
      expect(text).not.toMatch(/NaN|undefined/)
      expect(text.match(/facet normal/g) || []).toHaveLength(0)
    } finally {
      console.error = origError
    }
  })

  it('skips a facet with non-finite vertices instead of emitting NaN', () => {
    const errors = []
    const origError = console.error
    console.error = (...args) => { errors.push(args.join(' ')) }
    try {
      const mesh = {
        vertices: new Float32Array([0, 0, 0, NaN, 0, 0, 1, 1, 0]),
        indices: new Uint32Array([0, 1, 2])
      }
      const text = exportStlText([mesh]).join('')
      expect(errors.length).toBeGreaterThan(0)
      expect(text).not.toMatch(/NaN/)
      expect(text.match(/facet normal/g) || []).toHaveLength(0)
    } finally {
      console.error = origError
    }
  })

  it('keeps valid facets from a mesh that also has a bad one', () => {
    const origError = console.error
    console.error = () => {}
    try {
      const mesh = {
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 99])
      }
      const text = exportStlText([mesh]).join('')
      expect(text.match(/facet normal/g) || []).toHaveLength(1)
    } finally {
      console.error = origError
    }
  })

  it('wraps output in solid/endsolid JSCAD', () => {    const quad = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3])
    }
    const text = exportStlText([quad]).join('')
    expect(text.startsWith('solid JSCAD')).toBe(true)
    expect(text.trimEnd().endsWith('endsolid JSCAD')).toBe(true)
  })
})
