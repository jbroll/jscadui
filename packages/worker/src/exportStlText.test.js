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

  it('wraps output in solid/endsolid JSCAD', () => {
    const quad = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3])
    }
    const text = exportStlText([quad]).join('')
    expect(text.startsWith('solid JSCAD')).toBe(true)
    expect(text.trimEnd().endsWith('endsolid JSCAD')).toBe(true)
  })
})
