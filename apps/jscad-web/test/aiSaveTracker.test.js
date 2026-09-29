import { describe, expect, it } from 'vitest'
import { createSaveTracker } from '../src/aiSaveTracker.js'

describe('createSaveTracker', () => {
  it('starts unsaved', () => {
    expect(createSaveTracker().isSaved()).toBe(false)
  })

  it('is unsaved after an eval with no matching save', () => {
    const t = createSaveTracker()
    t.recordEval('a')
    expect(t.isSaved()).toBe(false)
  })

  it('is saved once writeModel matches the last eval', () => {
    const t = createSaveTracker()
    t.recordEval('a')
    t.recordSave('a')
    expect(t.isSaved()).toBe(true)
  })

  it('is saved right after writeModel, even with no prior eval', () => {
    const t = createSaveTracker()
    t.recordSave('a')
    expect(t.isSaved()).toBe(true)
  })

  it('goes unsaved again after a further eval with different source', () => {
    const t = createSaveTracker()
    t.recordSave('a')
    t.recordEval('b')
    expect(t.isSaved()).toBe(false)
  })
})
