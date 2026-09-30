import { describe, expect, it, vi } from 'vitest'
import { createExecutorClient } from './executor-protocol.js'
import { summarize } from './report.js'
import { regradeResults, freshExecutorGrader, runJob } from './run-eval.js'
import { fixture as nameplateFixture } from './fixtures/nameplate.js'
import { createSandboxedBackend } from './sandboxed-backend.js'
import { liveExecutors, startExecutor } from './sandbox.js'
import { everyFont, FONT_NAMES } from './fontCases.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const EXITS = 'module.exports = { main: () => process.exit(3) }'
const THROWS = 'module.exports = { main: () => { throw new Error("bad model") } }'
const SPINS = 'module.exports = { main: () => { for (;;); } }'
// Model code writing its own frames to the executor's channel, fd 3.
const FRAME = `const frame = (m) => { const b = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]) }
const fs = process.getBuiltinModule('fs')
const put = (buf) => { let at = 0; while (at < buf.length) { try { at += fs.writeSync(3, buf, at) } catch (e) { if (e.code !== 'EAGAIN') throw e } } }`
// Answers the conversation executor's first tool call (id 1, after reset's 0).
const forge = (value) => `${FRAME}\nmodule.exports = { main: () => { const id = 1; put(frame(${value})); return new Promise(() => {}) } }`

const fixture = {
  name: 'box',
  prompt: 'make a 20mm cube',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
}

let nextId = 0
const tool = (name, input) => [{ type: 'tool_use', id: `t${nextId++}`, name, input }, { type: 'done', stopReason: 'tool_use' }]
const write = (content) => tool('write', { path: 'main.js', content })
const done = () => [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }]
const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

const startChild = () => startExecutor({ api: 'fluent', sandbox: { kind: 'child' } })

const run = (rounds, options = {}, f = fixture) =>
  runJob({ fixture: f, run: 1, runs: 1, maxTurns: f.maxTurns }, { provider: scripted(rounds), api: 'fluent', startExecutor: startChild, ...options }, () => {})

const toolResults = (result) => result.transcript.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))

// An executor that exits before it is ready, as crt does when it cannot start the container.
const neverReady = () => {
  let exit
  const executor = createExecutorClient({ send: () => {}, onMessage: () => {}, onExit: (fn) => (exit = fn), kill: () => {} }, { api: 'fluent' })
  exit("code 1: Error: Chroot 'jscad-eval' not found")
  return executor
}

describe('replies model code forges from inside the executor', () => {
  it('cannot mark the run as a provider error', async () => {
    const result = await run([write(forge("{ type: 'reply', id, ok: false, error: 'empty provider reply' }")), done()])
    expect(result.providerError).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(toolResults(result)[0]).toEqual({ ok: false, error: { name: 'EvaluatorError', message: 'empty provider reply' } })
  }, 30_000)

  it('become a tool error when not a string, and the result serializes on the capped last round', async () => {
    const result = await run([write(forge("{ type: 'reply', id, ok: true, value: { x: 1 } }"))], {}, { ...fixture, maxTurns: 1 })
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(result.providerError).toBeUndefined()
    expect(toolResults(result)[0].error.name).toBe('EvaluatorError')
  }, 30_000)

  it('cap a long error and replace a result over the tool result limit', async () => {
    const longError = await run([write(forge("{ type: 'reply', id, ok: false, error: 'x'.repeat(5e5) }")), done()])
    expect(longError.transcript.find((m) => m.role === 'tool').content.length).toBeLessThan(5000)
    const bigResult = await run([write(forge("{ type: 'reply', id, ok: true, value: 'x'.repeat(5e5) }")), done()])
    expect(toolResults(bigResult)[0].error.name).toBe('ToolResultTooLarge')
  }, 30_000)

  it('that answer no outstanding request end the executor at the first one, and the model goes on', async () => {
    const flood = `${FRAME}\nmodule.exports = { main: () => { for (let i = 0; i < 300; i++) put(frame({ type: 'noise', pad: 'x'.repeat(1e6) })); return new Promise(() => {}) } }`
    const result = await run([write(flood), write(CUBE), done()])
    const [ended, evaluated] = toolResults(result)
    expect(ended.error.name).toBe('EvaluatorCrashed')
    expect(ended.error.message).toMatch(/the executor sent a frame that answers no request/)
    expect(evaluated.ok).toBe(true)
  }, 30_000)

  it('over the frame limit end the executor from the frame header, before the parent reads the body', async () => {
    const claim = `${FRAME}\nmodule.exports = { main: () => { const h = Buffer.alloc(4); h.writeUInt32BE(4e9); put(h); return new Promise(() => {}) } }`
    const result = await run([write(claim), write(CUBE), done()])
    const [ended, evaluated] = toolResults(result)
    expect(ended.error.name).toBe('EvaluatorCrashed')
    expect(ended.error.message).toMatch(/the executor sent a frame of 4000000000 bytes, over the \d+-byte limit/)
    expect(evaluated.ok).toBe(true)
  }, 30_000)

  it('a model error of any size comes back capped', async () => {
    const result = await run([write('module.exports = { main: () => { throw new Error("x".repeat(1e7)) } }'), done()])
    expect(toolResults(result)[0].error.message.length).toBeLessThan(5000)
  }, 30_000)
})

const NAMEPLATE = `const jf = require('@jbroll/jscad-fluent')
const jscadText = require('@jscadui/jscad-text')
jscadText.init(require('@jscad/modeling'))
const main = () => {
  const plate = jf.cuboid({ size: [120, 30, 4] }).translateZ(2)
  const outline = jscadText.text2d('JOHN', { size: 12, halign: 'center', valign: 'center', font: 'Liberation Sans' })
  return plate.union(new jf.FluentGeom2(outline).extrudeLinear({ height: 2 }).translateZ(4))
}
module.exports = { main }`

describe('@jscadui/jscad-text in the sandboxed executor', () => {
  it('loads with its bundled font under the permission model, and a nameplate grades in full', async () => {
    const result = await run([write(NAMEPLATE), done()], {}, nameplateFixture)
    expect(toolResults(result)[0]).toMatchObject({ ok: true, entry: 'main.js' })
    expect(result.report.checkRate).toBe(1)
  }, 30_000)

  it('serves every font of the static font map from local files, bold included', async () => {
    const executor = startChild()
    try {
      await executor.reset({})
      const res = JSON.parse(await executor.requestTool('write', { path: 'main.js', content: everyFont() }))
      expect(res.error).toBeUndefined()
      expect(res).toMatchObject({ ok: true, geometry: { parts: FONT_NAMES.length } })
    } finally {
      executor.close()
    }
  }, 60_000)
})

describe('an executor that model code ends', () => {
  it('is replaced by a fresh one holding the project, and the model goes on to a graded answer', async () => {
    const result = await run([write(EXITS), write(CUBE), tool('measure', {}), done()])
    const [crashed, written, measured] = toolResults(result)
    expect(crashed.error.name).toBe('EvaluatorCrashed')
    expect(crashed.error.message).toMatch(/model code ended the evaluator \(code 3/)
    expect(written.ok).toBe(true)
    expect(measured.volume).toBeCloseTo(8000, 0)
    expect(result.report.checkRate).toBe(1)
    expect(result.error).toBeUndefined()
    expect(result.providerError).toBeUndefined()
    expect(result.infraError).toBeUndefined()
  }, 30_000)

  it('keeps the transcript and counts the crash as a failed call', async () => {
    const result = await run([write(THROWS), write(THROWS), write(EXITS), done()])
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(3)
    expect(result.report.firstAttemptFailures).toBe(3)
    expect(result.metrics.failedCalls).toBe(3)
  }, 30_000)

  it('is restarted at most maxRestarts times, then every call fails and the run records why', async () => {
    const result = await run([write(EXITS), write(EXITS), write(CUBE), done()], { maxRestarts: 1 })
    const results = toolResults(result)
    expect(results.map((r) => r.error?.name)).toEqual(['EvaluatorCrashed', 'EvaluatorCrashed', 'EvaluatorCrashed'])
    expect(results[2].error.message).toMatch(/not restarted again/)
    expect(result.error).toBe('model code ended the evaluator 2 times')
    expect(result.infraError).toBeUndefined()
  }, 30_000)

  it('by running past the call time limit is killed and replaced', async () => {
    const result = await run([write(SPINS), write(CUBE), done()], { callTimeoutMs: 500 })
    const [spun, evaluated] = toolResults(result)
    expect(spun.error.message).toMatch(/ran past 0.5 s/)
    expect(evaluated.ok).toBe(true)
  }, 30_000)

  it('while grading grades nothing, and the run still scores', async () => {
    const PRIMES = 'globalThis.loads = 1\n' + CUBE
    const FIRST_LOAD_EXITS = 'globalThis.loads = (globalThis.loads ?? 0) + 1\nif (globalThis.loads === 1) process.exit(3)\n' + CUBE
    const result = await run([tool('run', { source: PRIMES }), write(FIRST_LOAD_EXITS), done()])
    expect(toolResults(result).map((r) => r.ok)).toEqual([true, true])
    expect(result.report.checkRate).toBe(0)
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(2)
    expect(result.providerError).toBeUndefined()
    expect(result.infraError).toBeUndefined()
    expect(summarize([result])[0].total).toBe(result.report.total)
  }, 30_000)
})

describe('an evaluator that never starts', () => {
  it('is an infrastructure error, left out of the means', async () => {
    const result = await run([write(CUBE), done()], { startExecutor: neverReady })
    expect(result.infraError).toBe(true)
    expect(result.error).toMatch(/the evaluator did not start: executor exited: code 1: Error: Chroot 'jscad-eval' not found/)
    expect(result.metrics.rounds).toBe(0)
    expect(summarize([result])[0].total).toBeNull()
  })

  it('on a restart after a crash is an infrastructure error too', async () => {
    let started = 0
    const start = () => (started++ === 0 ? startChild() : neverReady())
    const result = await run([write(EXITS), done()], { startExecutor: start })
    expect(result.infraError).toBe(true)
    expect(result.error).toMatch(/the evaluator did not start/)
  }, 30_000)

  it('for the grade is an infrastructure error', async () => {
    let started = 0
    const start = () => (started++ === 0 ? startChild() : neverReady())
    const result = await run([write(CUBE), done()], { startExecutor: start })
    expect(result.infraError).toBe(true)
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(1)
  }, 30_000)
})

describe('the run time limit', () => {
  it('ends the conversation and still grades what was saved', async () => {
    const slow = {
      calls: 0,
      async *send() {
        if (this.calls++ === 0) {
          yield* write(CUBE)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        yield* done()
      },
    }
    const result = await runJob({ fixture, run: 1, runs: 1, maxTurns: 8 }, { provider: slow, api: 'fluent', startExecutor: startChild, runTimeoutMs: 800 }, () => {})
    expect(result.error).toBe('run time limit of 0.8 s reached')
    expect(result.report.checkRate).toBe(1)
  }, 30_000)
})

describe('--regrade with a stored model that ends the executor', () => {
  it('grades that run as a failure and the rest as usual', async () => {
    const stored = (source) => ({
      fixture: 'box',
      run: 1,
      maxTurns: 8,
      report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
      metrics: {},
      transcript: [
        { role: 'user', content: fixture.prompt },
        { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'writeModel', input: { source } }] },
        { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    const file = { api: 'fluent', results: [stored(EXITS), stored(CUBE)] }
    const out = await regradeResults(file, new Map([['box', fixture]]), { grader: freshExecutorGrader(startChild) })
    expect(out.results.map((r) => r.report.checkRate)).toEqual([0, 1])
    expect(out.results[0].providerError).toBeUndefined()
  }, 30_000)
})

describe('createSandboxedBackend', () => {
  it('builds the seeded project on the first reset, and reseeds a restart with every write and edit so far', async () => {
    const seeds = []
    const start = () => {
      const executor = startChild()
      const reset = executor.reset
      executor.reset = (files, options) => {
        seeds.push(files)
        return reset(files, options)
      }
      return executor
    }
    const backend = createSandboxedBackend({ start })
    const EMPTY = 'module.exports = { main: () => [] }'
    try {
      expect(await backend.reset({ 'lib.js': 'module.exports = 1', 'main.js': EMPTY }, { build: true })).toMatchObject({ ok: true, entry: 'main.js', geometry: { parts: 0 } })
      await backend.requestTool('edit', { path: 'main.js', oldString: 'not there', newString: CUBE })
      await backend.requestTool('write', { path: 'part.js', content: 'module.exports = 2' })
      await backend.requestTool('edit', { path: 'main.js', oldString: EMPTY, newString: EXITS })
      expect(seeds).toEqual([
        { 'lib.js': 'module.exports = 1', 'main.js': EMPTY },
        { 'lib.js': 'module.exports = 1', 'main.js': EXITS, 'part.js': 'module.exports = 2' },
      ])
    } finally {
      backend.close()
    }
  }, 30_000)
})

// Model code that answers its own grade with a well-formed but nonsense measure.
const FORGES_GRADE = `${FRAME}
put(frame({ type: 'reply', id: 0, ok: true, value: { measure: { dimensions: 1, volume: 'x' }, solid: null, params: [] } }))
${CUBE}`

describe('a grade that breaks grading', () => {
  const targeted = { ...fixture, target: { dimensions: [20, 20, 20] }, checks: (m) => [{ name: 'size', pass: m ? m.dimensions.every((d) => d > 10) : false }] }

  it('grades nothing and keeps the transcript and first-attempt failures', async () => {
    const result = await run([write(THROWS), write(THROWS), write(FORGES_GRADE), done()], {}, targeted)
    expect(result.report.checkRate).toBe(0)
    // Its forged id 0 answers nothing in the conversation's executor, which ends there.
    expect(toolResults(result)[2].error.name).toBe('EvaluatorCrashed')
    expect(result.report.firstAttemptFailures).toBe(3)
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(3)
    expect(result.metrics.geometryError).toBeNull()
    expect(result.error).toBeUndefined()
  }, 30_000)

  it('in --regrade grades that run as a failure and goes on', async () => {
    const stored = (source) => ({
      fixture: 'box',
      run: 1,
      maxTurns: 8,
      report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
      metrics: {},
      transcript: [
        { role: 'user', content: fixture.prompt },
        { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'writeModel', input: { source } }] },
        { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    const file = { api: 'fluent', results: [stored(FORGES_GRADE), stored(CUBE)] }
    const out = await regradeResults(file, new Map([['box', targeted]]), { grader: freshExecutorGrader(startChild) })
    expect(out.results.map((r) => r.report.checkRate)).toEqual([0, 1])
  }, 30_000)
})

describe('a restart still starting when the run ends', () => {
  it('is closed as soon as it is ready, and no executor outlives the run', async () => {
    let started = 0
    let releaseRestart
    const start = () => {
      started += 1
      const executor = startChild()
      if (started !== 2) return executor
      const ready = executor.ready
      executor.ready = new Promise((resolve, reject) => {
        releaseRestart = () => ready.then(resolve, reject)
      })
      return executor
    }
    const backend = createSandboxedBackend({ start })
    await backend.reset({})
    const crashed = backend.requestTool('write', { path: 'main.js', content: EXITS })
    await vi.waitFor(() => expect(releaseRestart).toBeTypeOf('function'))
    await backend.gradeProject(null)
    releaseRestart()
    expect(JSON.parse(await crashed).error.name).toBe('EvaluatorCrashed')
    await vi.waitFor(() => expect(liveExecutors()).toBe(0))
  }, 30_000)
})

