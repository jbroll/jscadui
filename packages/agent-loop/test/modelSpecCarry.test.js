import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEvalBackend } from '../eval/backend.js'
import { buildMessages } from '../src/context.js'
import { buildSystemPrompt } from '../src/prompt.js'

const example = readFileSync(new URL('../prompt/examples/modeling/01-sphere-union.js', import.meta.url), 'utf8')

describe('model spec end to end (eval backend)', () => {
  it('a spec write skips the test suite and the next turn carries it', async () => {
    const backend = createEvalBackend({ api: 'modeling' })
    const main = JSON.parse(await backend.requestTool('write', { path: 'main.js', content: example }))
    expect(main.ok).toBe(true)
    expect(main.tests).toBeDefined()
    const spec = JSON.parse(await backend.requestTool('write', { path: 'notes/model-spec.md', content: '## Intent\n\nSPEC-MARKER-123 a bracket.\n' }))
    expect(spec.ok).toBe(true)
    expect(spec.tests).toBeUndefined()
    const messages = buildMessages({ systemPrompt: buildSystemPrompt('modeling'), transcript: [], files: backend.files(), build: backend.lastBuild(), message: 'again' })
    const project = messages.find((m) => m.role === 'user' && m.content.includes('Model spec:'))
    expect(project).toBeDefined()
    expect(project.content).toContain('SPEC-MARKER-123')
  })
})
