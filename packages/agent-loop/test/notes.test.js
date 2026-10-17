import { describe, expect, it } from 'vitest'
import { notesIndex } from '../src/notes.js'
import { projectMessage } from '../src/context.js'
describe('notesIndex', () => {
  it('lists notes/ headers and skips non-notes', () => {
    const out = notesIndex({ 'notes/plan.md': '---\ndescription: Lid plan\n---\nbody', 'main.js': 'x' })
    expect(out).toContain('plan.md')
    expect(out).toContain('Lid plan')
  })

  it('keeps note bodies out of projectMessage while the header stays in the index', () => {
    const project = projectMessage({ 'main.js': 'M', 'notes/plan.md': '---\ndescription: Lid plan\n---\nsecret body text' }, null)
    expect(project.content).not.toContain('secret body text')
    expect(project.content).not.toContain('### notes/plan.md')
    expect(project.content).toContain('### main.js')
    expect(project.content).toContain('Lid plan')
  })
})
