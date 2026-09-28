// packages/agent-loop/test/tools.test.js
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/tools.js'

describe('agent tools', () => {
  it('exposes the six browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['eval', 'params', 'measure', 'check', 'export', 'writeModel'])
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('does not offer view to the model', () => {
    expect(TOOLS.map((t) => t.name)).not.toContain('view')
  })
})