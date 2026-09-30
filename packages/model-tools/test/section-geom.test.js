import { describe, expect, it } from 'vitest'
import { createWelder, crossing, signedArea } from '../src/section-geom.js'

describe('createWelder', () => {
  it('gives 2D points within tolerance one id, across a cell boundary', () => {
    const weld = createWelder(0.1)
    expect(weld([0.099, 0])).toBe(0)
    expect(weld([0.101, 0.05])).toBe(0)
    expect(weld([0.25, 0])).toBe(1)
  })

  it('welds 3D points on every coordinate', () => {
    const weld = createWelder(0.1)
    expect(weld([1, 2, 3])).toBe(0)
    expect(weld([1.05, 2.05, 2.95])).toBe(0)
    expect(weld([1, 2, 3.2])).toBe(1)
  })
})

describe('crossing', () => {
  it('cuts a square across the plane into one segment', () => {
    const square = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 0],
    ]
    expect(crossing(square, 0, 1)).toEqual([
      [1, 0, 0],
      [1, 2, 0],
    ])
    expect(crossing(square, 0, 3)).toBeNull()
  })
})

describe('signedArea', () => {
  it('is positive counterclockwise and negative clockwise', () => {
    const ccw = [
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
    ]
    expect(signedArea(ccw)).toBe(6)
    expect(signedArea([...ccw].reverse())).toBe(-6)
  })
})
