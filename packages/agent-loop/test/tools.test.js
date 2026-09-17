// packages/agent-loop/test/tools.test.js
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/tools.js'

describe('agent tools', () => {
  it('exposes the seven browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['eval', 'params', 'measure', 'check', 'view', 'export', 'writeModel'])
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('keeps prompt.js in sync with prompt.md', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const dir = dirname(fileURLToPath(import.meta.url))
    const md = await readFile(join(dir, '..', 'prompt.md'), 'utf-8')
    const { SYSTEM_PROMPT } = await import('../src/prompt.js')
    expect(SYSTEM_PROMPT.trim()).toBe(md.trim().replace(/^<!--[\s\S]*?-->\n/, ''))
  })
})