import { describe, expect, it } from 'vitest'
import { createSaveTracker } from '../src/aiSaveTracker.js'

describe('createSaveTracker', () => {
  it('starts unsaved', () => {
    expect(createSaveTracker().isSaved()).toBe(false)
  })

  it('is unsaved after an eval with no matching save', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a' })
    expect(t.isSaved()).toBe(false)
  })

  it('is saved once writeModel matches every file the eval used', () => {
    const t = createSaveTracker()
    t.recordSave('main.js', 'a')
    t.recordEval({ 'main.js': 'a' })
    expect(t.isSaved()).toBe(true)
  })

  it('goes unsaved again after a further eval with different source for the same entry', () => {
    const t = createSaveTracker()
    t.recordSave('main.js', 'a')
    t.recordEval({ 'main.js': 'a' })
    t.recordEval({ 'main.js': 'b' })
    expect(t.isSaved()).toBe(false)
  })

  // The bug this fixes: a write to an unrelated file must not make an
  // unrelated, still-unsaved eval read as saved.
  it('writing a different entry does not make an unrelated unsaved eval report saved', () => {
    const t = createSaveTracker()
    t.recordSave('main.js', 'M1')
    t.recordEval({ 'main.js': 'M2' }) // an unsaved draft of main.js
    expect(t.isSaved()).toBe(false)
    t.recordSave('helpers.js', 'H1') // writing an unrelated file
    expect(t.isSaved()).toBe(false)
  })

  it('is unsaved if any file the eval used has since been saved with different content', () => {
    const t = createSaveTracker()
    t.recordSave('main.js', 'M1')
    t.recordSave('helpers.js', 'H1')
    t.recordEval({ 'main.js': 'M1', 'helpers.js': 'H1' })
    expect(t.isSaved()).toBe(true)
    t.recordSave('helpers.js', 'H2') // helpers.js changes underneath the same eval
    expect(t.isSaved()).toBe(false)
  })

  it('files() reflects every entry saved so far', () => {
    const t = createSaveTracker()
    t.recordSave('main.js', 'M1')
    t.recordSave('helpers.js', 'H1')
    expect(t.files()).toEqual({ 'main.js': 'M1', 'helpers.js': 'H1' })
  })
})
