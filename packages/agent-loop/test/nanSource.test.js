import { describe, expect, it } from 'vitest'
import { nanSourceHint } from '../src/nanSource.js'

const CAUSE = ': an undefined or NaN value in the arithmetic that made it gives NaN'

describe('nanSourceHint', () => {
  it('quotes the expression behind each NaN element and the names it reads', () => {
    const files = { 'chassis.js': 'const a = 1\nconst deck = jf.cuboid({ size: [params._length - 4, params._width - 2, 3] })\n' }
    expect(nanSourceHint(`jf.cuboid: size[0], size[1] are NaN${CAUSE}`, files, 'chassis.js', 2)).toBe(
      'size[0] is params._length - 4 and size[1] is params._width - 2 at chassis.js:2; one of params._length, params._width is undefined or NaN there',
    )
  })

  it('follows an option onto the lines after the call, past nested brackets and strings', () => {
    const files = {
      'parts/u.js': [
        '  const arm = jf.roundedCuboid({',
        "    roundRadius: Math.min(d.r, 2), label: 'a, b',",
        '    size: [armLen, d.armHalfW * 2, f(d.z1, [1, 2]) - d.armZ0],',
        '  })',
      ].join('\n'),
    }
    expect(nanSourceHint(`jf.roundedCuboid: size[1], size[2] are NaN${CAUSE}`, files, 'parts/u.js', 1)).toBe(
      'size[1] is d.armHalfW * 2 and size[2] is f(d.z1, [1, 2]) - d.armZ0 at parts/u.js:1; one of d.armHalfW, f, d.z1, d.armZ0 is undefined or NaN there',
    )
  })

  it('quotes a number option', () => {
    const files = { 'main.js': 'jf.cylinder({ radius: 2, height: cfg.tall * 2 })' }
    expect(nanSourceHint(`jf.cylinder: height is NaN${CAUSE}`, files, 'main.js', 1)).toBe(
      'height is cfg.tall * 2 at main.js:1; cfg.tall is undefined or NaN there',
    )
  })

  it('answers null when it cannot find the option written out', () => {
    expect(nanSourceHint(`jf.cuboid: size[0] is NaN${CAUSE}`, { 'main.js': 'jf.cuboid({ size })' }, 'main.js', 1)).toBe(null)
    expect(nanSourceHint(`jf.cuboid: size[0] is NaN${CAUSE}`, {}, 'main.js', 1)).toBe(null)
    expect(nanSourceHint('x is not defined', { 'main.js': 'x' }, 'main.js', 1)).toBe(null)
  })
})
