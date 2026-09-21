import { describe, it, expect } from 'vitest'
import { withRenderFn } from '../bin/exampleCode.js'

describe('withRenderFn', () => {
  it('pins $fn on a plain call', () => {
    expect(withRenderFn('cube(10)')).toBe('cube(10, $fn=32);')
  })

  it('drops library prose after the call', () => {
    expect(withRenderFn('flatten([[1,2,3], [4,5,[6,7,8]]]) returns [1,2,3,4,5,[6,7,8]]'))
      .toBe('flatten([[1,2,3], [4,5,[6,7,8]]], $fn=32);')
  })

  it('ignores an unbalanced extra paren from the source doc', () => {
    expect(withRenderFn('cumprod([[1,2,3], [3,4,5]]));'))
      .toBe('cumprod([[1,2,3], [3,4,5]], $fn=32);')
  })

  it('keeps a trailing comment', () => {
    expect(withRenderFn('log2(256);  // Returns: 8')).toBe('log2(256, $fn=32);  // Returns: 8')
  })

  it('patches only the last statement of a block', () => {
    expect(withRenderFn('log2(0.125);\nlog2(16);'))
      .toBe('log2(0.125);\nlog2(16, $fn=32);')
  })

  it('leaves a call that takes no arguments', () => {
    expect(withRenderFn('nothing()')).toBe('nothing();')
  })

  it('leaves code that already sets $fn', () => {
    expect(withRenderFn('sphere(r=5, $fn=64);')).toBe('sphere(r=5, $fn=64);')
  })
})
