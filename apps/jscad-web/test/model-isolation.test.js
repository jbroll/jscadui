import { describe, expect, it } from 'vitest'
import { createModelIsolation } from '../src_frame/modelIsolation.js'

const fakeText = () => {
  const text = { state: 'clean' }
  Object.assign(text, {
    saveState: () => text.state,
    restoreState: (saved) => {
      text.state = saved
    },
    reset: () => {
      text.state = 'clean'
    },
  })
  return text
}

const TEXT = '@jscadui/jscad-text'

describe('frame model isolation', () => {
  it('resets jscad-text once a model has required it, and restores what it held', () => {
    const isolation = createModelIsolation()
    const text = fakeText()
    isolation.seen(TEXT, text)
    text.state = 'model'
    const restore = isolation.isolate()
    expect(text.state).toBe('clean')
    text.state = 'run'
    restore()
    expect(text.state).toBe('model')
  })

  it('resets a module first required during the isolated run when it ends', () => {
    const isolation = createModelIsolation()
    const restore = isolation.isolate()
    const text = fakeText()
    isolation.seen(TEXT, text)
    text.state = 'run'
    restore()
    expect(text.state).toBe('clean')
  })

  it('leaves other modules alone', () => {
    const isolation = createModelIsolation()
    const other = fakeText()
    isolation.seen('@jscad/modeling', other)
    other.state = 'model'
    isolation.isolate()
    expect(other.state).toBe('model')
  })

  it('sets a module up when first required and after every reset', () => {
    const isolation = createModelIsolation({ setUp: { [TEXT]: (text) => (text.state = 'set up') } })
    const text = fakeText()
    isolation.seen(TEXT, text)
    expect(text.state).toBe('set up')
    text.state = 'model'
    const restore = isolation.isolate()
    expect(text.state).toBe('set up')
    restore()
    expect(text.state).toBe('model')

    const later = fakeText()
    const restoreRun = isolation.isolate()
    isolation.seen(TEXT, later)
    later.state = 'run'
    restoreRun()
    expect(later.state).toBe('set up')
  })
})
