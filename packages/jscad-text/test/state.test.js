import { afterEach, describe, expect, it } from 'vitest'
import jscad from '@jscad/modeling'
import { init, listFonts, registerFonts, reset, restoreState, saveState, STATIC_FONT_MAP, text2d } from '../src/index.js'

afterEach(reset)

describe('model state', () => {
  it('reset forgets init, so text2d asks for it again', () => {
    init(jscad)
    expect(text2d('A')).not.toBeNull()
    reset()
    expect(() => text2d('A')).toThrow('jscad-text: call init(jscad) before using text2d()')
  })

  it('reset drops fonts a model registered and keeps the static map', () => {
    registerFonts({ Mine: 'https://example.com/mine.ttf' })
    reset()
    expect(listFonts()).toEqual(Object.keys(STATIC_FONT_MAP))
  })

  it('restoreState puts back what saveState took', () => {
    init(jscad)
    registerFonts({ Mine: 'https://example.com/mine.ttf' })
    const saved = saveState()
    reset()
    restoreState(saved)
    expect(text2d('A')).not.toBeNull()
    expect(listFonts()).toContain('Mine')
  })
})
