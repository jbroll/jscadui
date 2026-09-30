import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { runSuite } from './run-eval.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const TALL = CUBE.replace('jf.cube({ size: 20 })', 'jf.cuboid({ size: [20, 20, 40] })')
const write = (id, content) => ({ type: 'tool_use', id, name: 'write', input: { path: 'main.js', content } })
const done = (stopReason) => ({ type: 'done', stopReason })

// Records a copy of what each call sent: runTurn keeps appending to the array it passes.
const recording = (rounds) => {
  const seen = []
  return {
    seen,
    async *send(messages) {
      seen.push([...messages])
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

const fixture = {
  name: 'two-turns',
  prompt: 'a cube',
  followUps: [{ message: 'make it taller' }],
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => [{ name: 'tall', pass: (m?.dimensions?.[2] ?? 0) >= 40 }],
}

describe('follow-ups', () => {
  it('sends each follow-up after the turn before it, with the earlier turns as text', async () => {
    const provider = recording([
      [{ type: 'text', text: 'Here is a cube.' }, write('t1', CUBE), done('tool_use')],
      [{ type: 'text', text: ' Saved.' }, done('end_turn')],
      [write('t2', TALL), done('tool_use')],
      [{ type: 'text', text: 'Taller now.' }, done('end_turn')],
    ])
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    const second = provider.seen[2]
    expect(second.slice(1, 3)).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Here is a cube. Saved.' },
    ])
    expect(second.at(-2).content).toContain('jf.cube({ size: 20 })')
    expect(second.at(-2).content).toContain('Last build of the project')
    expect(second.at(-1)).toEqual({ role: 'user', content: 'make it taller' })
    expect(result.error).toBeUndefined()
    expect(result.report.checkRate).toBe(1)
    expect(result.metrics.rounds).toBe(4)
    expect(result.transcript.filter((m) => m.role === 'user' && ['a cube', 'make it taller'].includes(m.content))).toHaveLength(2)
  })

  it('gives each user message its own turn cap', async () => {
    const provider = recording([[write('t1', CUBE), done('tool_use')], [write('t2', TALL), done('tool_use')]])
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend(), maxTurns: 1 })
    expect(provider.seen).toHaveLength(2)
    expect(provider.seen[1].at(-1)).toEqual({ role: 'user', content: 'make it taller' })
    expect(result.error).toBeUndefined()
    expect(result.report.checkRate).toBe(1)
  })

  it('sends no follow-up after a turn that failed', async () => {
    const seen = []
    const provider = {
      async *send(messages) {
        seen.push([...messages])
        if (seen.length > 1) throw new Error('status 500')
        yield write('t1', CUBE)
        yield done('tool_use')
      },
    }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(seen).toHaveLength(2)
    expect(seen.flat().some((m) => m.content === 'make it taller')).toBe(false)
    expect(result.error).toBe('status 500')
    expect(result.providerError).toBe(true)
  })
})
