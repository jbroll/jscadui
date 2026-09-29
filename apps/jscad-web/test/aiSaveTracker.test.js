import { describe, expect, it } from 'vitest'
import { createSaveTracker } from '../src/aiSaveTracker.js'

describe('createSaveTracker', () => {
  it('reports nothing unsaved before the agent evaluates anything', () => {
    expect(createSaveTracker().isUnsaved({ 'main.js': 'a' })).toBe(false)
  })

  it('is unsaved when the project does not hold what the eval ran', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a' })
    expect(t.isUnsaved({})).toBe(true)
    expect(t.isUnsaved({ 'main.js': 'b' })).toBe(true)
  })

  it('is saved once the project matches every file the eval used', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'M1', 'helpers.js': 'H1' })
    expect(t.isUnsaved({ 'main.js': 'M1', 'helpers.js': 'H1', 'other.js': 'x' })).toBe(false)
  })

  it('is unsaved if any file the eval used has since changed', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'M1', 'helpers.js': 'H1' })
    expect(t.isUnsaved({ 'main.js': 'M1', 'helpers.js': 'H2' })).toBe(true)
  })

  it('goes unsaved again after a further eval with different source for the same entry', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a' })
    t.recordEval({ 'main.js': 'b' })
    expect(t.isUnsaved({ 'main.js': 'a' })).toBe(true)
  })

  it('skips binary files, which the agent cannot write and each read copies anew', () => {
    const t = createSaveTracker()
    t.recordEval({ 'main.js': 'a', 'part.stl': new ArrayBuffer(4) })
    expect(t.isUnsaved({ 'main.js': 'a', 'part.stl': new ArrayBuffer(4) })).toBe(false)
  })
})
