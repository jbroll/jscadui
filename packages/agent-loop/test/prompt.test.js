import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { SYSTEM_PROMPT } from '../src/prompt.js'
import { EXAMPLES } from '../prompt/index.js'
import { createEvalBackend } from '../eval/backend.js'

const dir = new URL('../prompt/examples/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
const read = (file) => readFileSync(new URL(file, dir), 'utf8')

describe('system prompt', () => {
  it('starts with prompt.md', () => {
    const md = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8').trim()
    expect(SYSTEM_PROMPT.startsWith(md)).toBe(true)
  })

  it('lists every example file in file-name order', () => {
    expect(EXAMPLES.map((e) => e.file)).toEqual(files)
  })

  it('carries every example after the Examples heading, in order', () => {
    let at = SYSTEM_PROMPT.indexOf('## Examples')
    expect(at).toBeGreaterThan(0)
    for (const file of files) {
      const next = SYSTEM_PROMPT.indexOf(read(file).trim(), at)
      expect(next).toBeGreaterThan(at)
      at = next
    }
  })

  it.each(files)('%s opens with a one-line comment naming its request', (file) => {
    expect(read(file).split('\n')[0]).toMatch(/^\/\/ \S/)
  })

  it.each(files)('%s evaluates in the eval backend', async (file) => {
    const res = JSON.parse(await createEvalBackend().requestTool('eval', { source: read(file) }))
    expect(res).toMatchObject({ ok: true })
  })
})
