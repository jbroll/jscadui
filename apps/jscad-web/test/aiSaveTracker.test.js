import { describe, expect, it } from 'vitest'
import { createSaveTracker } from '../src/aiSaveTracker.js'

describe('createSaveTracker', () => {
  it('starts unsaved', () => {
    expect(createSaveTracker().isSaved({ 'main.js': 'a' })).toBe(false)
  })

  it('is unsaved when the project does not hold what the eval ran', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a' })
    expect(t.isSaved({})).toBe(false)
    expect(t.isSaved({ 'main.js': 'b' })).toBe(false)
  })

  it('is saved once the project matches every file the eval used', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'M1', 'helpers.js': 'H1' })
    expect(t.isSaved({ 'main.js': 'M1', 'helpers.js': 'H1', 'other.js': 'x' })).toBe(true)
  })

  it('is unsaved if any file the eval used has since changed', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'M1', 'helpers.js': 'H1' })
    expect(t.isSaved({ 'main.js': 'M1', 'helpers.js': 'H2' })).toBe(false)
  })

  it('goes unsaved again after a further eval with different source for the same entry', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a' })
    t.recordEval({ 'main.js': 'b' })
    expect(t.isSaved({ 'main.js': 'a' })).toBe(false)
  })

  it('skips binary files, which the agent cannot write and each read copies anew', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a', 'part.stl': new ArrayBuffer(4) })
    expect(t.isSaved({ 'main.js': 'a', 'part.stl': new ArrayBuffer(4) })).toBe(true)
  })
})
