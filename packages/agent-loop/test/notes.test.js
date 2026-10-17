import { describe, expect, it } from 'vitest'
import { notesIndex } from '../src/notes.js'
describe('notesIndex', () => {
  it('lists notes/ headers and skips non-notes', () => {
    const out = notesIndex({ 'notes/plan.md': '---\ndescription: Lid plan\n---\nbody', 'main.js': 'x' })
    expect(out).toContain('plan.md')
    expect(out).toContain('Lid plan')
  })
})
