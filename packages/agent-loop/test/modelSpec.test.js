import { describe, expect, it } from 'vitest'
import { projectMessage } from '../src/context.js'
import { SPEC_BUDGET, SPEC_HEADER, SPEC_PATH, specSection } from '../src/modelSpec.js'

describe('specSection', () => {
  it('returns null when the spec file is absent, empty, or binary', () => {
    expect(specSection({})).toBeNull()
    expect(specSection({ 'main.js': 'x' })).toBeNull()
    expect(specSection({ [SPEC_PATH]: '' })).toBeNull()
    expect(specSection({ [SPEC_PATH]: new ArrayBuffer(8) })).toBeNull()
  })

  it('inlines the whole spec under the Model spec header when it fits', () => {
    const body = '## Intent\n\na bracket.\n'
    expect(specSection({ [SPEC_PATH]: body })).toBe(`${SPEC_HEADER}\n\n${body}`)
  })

  it('keeps the newest lines with a truncated note when over budget', () => {
    const first = 'FIRST-LINE-KEEP-ME-OUT'
    const last = 'LAST-LINE-KEEP-ME-IN'
    const body = `${first}\n${'x\n'.repeat(SPEC_BUDGET)}${last}\n`
    const out = specSection({ [SPEC_PATH]: body })
    expect(out).toContain('[truncated:')
    expect(out).toContain(last)
    expect(out).not.toContain(first)
  })
})

describe('projectMessage with a model spec', () => {
  it('carries the full spec while trimming code files under budget pressure', () => {
    const spec = '## Intent\n\na bracket for M3 screws.\n'
    const files = { 'main.js': `// entry\n${'x'.repeat(30_000)}\n`, [SPEC_PATH]: spec }
    const message = projectMessage(files, null, [], 8000)
    expect(message.content).toContain(spec)
    expect(message.content).toContain(SPEC_HEADER)
  })

  it('contains no Model spec heading when the project has no spec file', () => {
    const message = projectMessage({ 'main.js': '// entry\n' }, null)
    expect(message.content).not.toContain('Model spec')
  })
})
