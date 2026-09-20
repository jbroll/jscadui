import { describe, it, expect, beforeAll } from 'vitest'
import { init, cube, measureVolume } from '../src/index.js'
import { colorize } from '../src/colors/index.js'

describe('clone ownership', () => {
  beforeAll(async () => { await init() })
  it('dispose of clone leaves original usable', () => {
    const c = cube({ size: 10 })
    const volBefore = measureVolume(c)
    const copy = c.clone()
    copy.dispose()
    expect(measureVolume(c)).toBeCloseTo(volBefore, 1)
  })
  it('dispose of colorize source leaves colored usable', () => {
    const c = cube({ size: 10 })
    const colored = colorize([1, 0, 0], c)
    c.dispose()
    expect(measureVolume(colored)).toBeCloseTo(1000, 0)
  })
})
