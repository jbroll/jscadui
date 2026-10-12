import { describe, expect, it } from 'vitest'
import { matrix2str } from '../src/matrix2str.js'

describe('matrix2str', () => {
  it('passes string transforms through unchanged', () => {
    const m = Array.from({ length: 16 }, (_, i) => (i * 1.5).toFixed(4))
    expect(matrix2str(m)).toBe(
      '0.0000 1.5000 3.0000 6.0000 7.5000 9.0000 12.0000 13.5000 15.0000 18.0000 19.5000 21.0000',
    )
  })

  it('emits finite numbers as numbers', () => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
    expect(matrix2str(m)).toBe('1 0 0 0 1 0 0 0 1 5 6 7')
  })

  it('replaces non-finite numbers with 0', () => {
    const m = [NaN, 0, Infinity, 0, 0, -Infinity, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1]
    expect(matrix2str(m)).toBe('0 0 0 0 0 0 0 0 1 0.5 0 0')
  })

  it('rejects a matrix without 16 elements', () => {
    expect(() => matrix2str([1, 0, 0, 0])).toThrow(/16 elements/)
    expect(() => matrix2str(null)).toThrow(/Invalid matrix/)
    expect(() => matrix2str(undefined)).toThrow(/Invalid matrix/)
  })
})
