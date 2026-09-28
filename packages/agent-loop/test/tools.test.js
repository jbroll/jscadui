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
})