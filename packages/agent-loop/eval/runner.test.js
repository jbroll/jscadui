import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { runSuite } from './run-eval.js'

const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

describe('runSuite', () => {
  it('runs a fixture against a scripted provider and grades it', async () => {
    const backend = createEvalBackend()
    const provider = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.cube({ size: 20 })] }\nmodule.exports = { main }' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'tool_use', id: 't2', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'a 20mm cube' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const fixture = {
      name: 'smoke',
      prompt: 'make a cube',
      requires: ['eval', 'measure'],
      verifyBeforeWrite: false,
      maxTurns: 8,
      checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
    }
    const results = await runSuite([fixture], { provider, backend })
    expect(results).toHaveLength(1)
    expect(results[0].report.dimensions.discipline).toBe(2)
    expect(results[0].report.total).toBeGreaterThanOrEqual(6)
  })

  it('refuses without a provider', async () => {
    await expect(runSuite([], { provider: null, backend: createEvalBackend() })).rejects.toThrow(/provider/)
  })
})
