import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { createExecutorClient, ExecutorExited, MAX_TOOL_RESULT_BYTES, serveExecutor } from './executor-protocol.js'

// Two in-memory transport ends; messages cross through structuredClone, as IPC copies them.
const transportPair = () => {
  const handlers = { client: [], server: [] }
  const exitHandlers = []
  const sent = []
  let killed = false
  const deliver = (to, message) => queueMicrotask(() => handlers[to].forEach((fn) => fn(structuredClone(message))))
  const exit = (reason) => exitHandlers.forEach((fn) => fn(reason))
  const client = {
    send: (message) => {
      sent.push(message)
      if (!killed) deliver('server', message)
    },
    onMessage: (fn) => handlers.client.push(fn),
    onExit: (fn) => exitHandlers.push(fn),
    kill: () => {
      killed = true
      exit('killed')
    },
  }
  const server = { send: (message) => deliver('client', message), onMessage: (fn) => handlers.server.push(fn) }
  return { client, server, sent, exit, killed: () => killed }
}

const fakeBackend = (overrides = {}) => ({
  reset: () => null,
  requestTool: async (name, input) => JSON.stringify({ name, input }),
  gradeProject: async (model) => ({ measure: { model }, solid: null, params: [] }),
  ...overrides,
})

describe('executor protocol', () => {
  it('creates the backend under the api the client names and answers each method', async () => {
    const { client, server } = transportPair()
    const apis = []
    serveExecutor(server, ({ api }) => {
      apis.push(api)
      return fakeBackend()
    })
    const executor = createExecutorClient(client, { api: 'modeling' })
    expect(await executor.ready).toBe('modeling')
    expect(apis).toEqual(['modeling'])
    expect(await executor.reset({ 'main.js': 'x' })).toBeNull()
    expect(JSON.parse(await executor.requestTool('run', { source: 's' }))).toEqual({ name: 'run', input: { source: 's' } })
    expect(await executor.gradeProject({ files: {}, entry: 'main.js' })).toEqual({ measure: { model: { files: {}, entry: 'main.js' } }, solid: null, params: [] })
  })

  it('runs a real eval backend behind the protocol', async () => {
    const { client, server } = transportPair()
    serveExecutor(server, createEvalBackend)
    const executor = createExecutorClient(client, { api: 'fluent' })
    const source = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 10 })] }'
    expect(await executor.reset({ 'main.js': source }, { build: true })).toMatchObject({ ok: true, entry: 'main.js', geometry: { volume: 1000 } })
    expect(JSON.parse(await executor.requestTool('write', { path: 'main.js', content: source.replace('size: 10', 'size: 20') })).ok).toBe(true)
    expect(JSON.parse(await executor.requestTool('measure', {})).volume).toBeCloseTo(8000, 0)
  })

  it('answers a tool call the backend throws on with a tool error', async () => {
    const { client, server } = transportPair()
    serveExecutor(server, () =>
      fakeBackend({
        requestTool: async () => {
          throw new Error('boom')
        },
      }),
    )
    const executor = createExecutorClient(client, { api: 'fluent' })
    expect(JSON.parse(await executor.requestTool('run', {}))).toEqual({ ok: false, error: { name: 'EvaluatorError', message: 'boom' } })
  })

  it('refuses a method outside the backend protocol', async () => {
    const { client, server } = transportPair()
    serveExecutor(server, () => fakeBackend({ project: new Map() }))
    createExecutorClient(client, { api: 'fluent' })
    const replies = []
    const reply = new Promise((resolve) => {
      client.onMessage((message) => {
        if (message.type === 'reply') {
          replies.push(message)
          resolve()
        }
      })
    })
    client.send({ type: 'call', id: 99, method: 'constructor', args: [] })
    await reply
    expect(replies[0]).toEqual({ type: 'reply', id: 99, ok: false, error: 'unknown method constructor' })
  })

  it('answers a later call while an earlier one is still running', async () => {
    const { client, server } = transportPair()
    let release
    serveExecutor(server, () =>
      fakeBackend({
        requestTool: () => new Promise((resolve) => (release = () => resolve('slow'))),
      }),
    )
    const executor = createExecutorClient(client, { api: 'fluent' })
    const slow = executor.requestTool('run', {})
    expect(await executor.gradeProject(null)).toEqual({ measure: { model: null }, solid: null, params: [] })
    release()
    expect(await slow).toBe('slow')
  })

  it('rejects pending and later calls once the executor exits', async () => {
    const { client, server, exit } = transportPair()
    serveExecutor(server, () => fakeBackend({ requestTool: () => new Promise(() => {}) }))
    const executor = createExecutorClient(client, { api: 'fluent' })
    await executor.ready
    const pending = executor.requestTool('run', {})
    exit('code 3')
    await expect(pending).rejects.toThrow('executor exited: code 3')
    await expect(pending).rejects.toBeInstanceOf(ExecutorExited)
    await expect(executor.requestTool('measure', {})).rejects.toThrow('executor exited: code 3')
    expect(executor.alive()).toBe(false)
  })

  it('rejects ready when the executor exits before it starts', async () => {
    const { client, exit } = transportPair()
    const executor = createExecutorClient(client, { api: 'fluent' })
    exit('crt: rootfs not found')
    await expect(executor.ready).rejects.toThrow('executor exited: crt: rootfs not found')
  })

  it('gives up on a grade the executor never answers, kills it and grades nothing', async () => {
    const { client, server, killed } = transportPair()
    serveExecutor(server, () => fakeBackend({ gradeProject: () => new Promise(() => {}) }))
    const executor = createExecutorClient(client, { api: 'fluent', graceMs: 5 })
    expect(await executor.gradeProject({ files: {}, entry: 'main.js' }, { timeoutMs: 5 })).toEqual({ measure: null, solid: null, params: [] })
    expect(killed()).toBe(true)
  })

  it('sends the executor only the api and backend calls', async () => {
    const { client, server, sent } = transportPair()
    serveExecutor(server, () => fakeBackend())
    const executor = createExecutorClient(client, { api: 'fluent' })
    await executor.requestTool('params', {})
    expect(sent.map((m) => m.type)).toEqual(['init', 'call'])
    expect(sent[0]).toEqual({ type: 'init', api: 'fluent' })
  })

  it('kills the executor when a call runs past its time limit', async () => {
    const { client, server, killed } = transportPair()
    serveExecutor(server, () => fakeBackend({ requestTool: () => new Promise(() => {}) }))
    const executor = createExecutorClient(client, { api: 'fluent' })
    await expect(executor.requestTool('run', {}, { timeoutMs: 5 })).rejects.toThrow('executor exited: ran past 0.005 s')
    expect(killed()).toBe(true)
  })
})

// Replies model code in the executor's process can send in place of the backend's.
describe('forged executor replies', () => {
  const forged = async (method, reply) => {
    const { client } = transportPair()
    const handlers = []
    const executor = createExecutorClient({ ...client, onMessage: (fn) => handlers.push(fn) }, { api: 'fluent' })
    const answer = method === 'gradeProject' ? executor.gradeProject({ files: {}, entry: 'main.js' }) : executor[method]('run', {})
    for (const fn of handlers) fn({ type: 'reply', id: 0, ...reply })
    return answer
  }

  it('turns an error reply into a tool error, never a rejected call', async () => {
    expect(JSON.parse(await forged('requestTool', { ok: false, error: 'empty provider reply' }))).toEqual({
      ok: false,
      error: { name: 'EvaluatorError', message: 'empty provider reply' },
    })
    expect(JSON.parse(await forged('requestTool', { ok: false, error: { toString: 1 } })).error.message).toBe('malformed executor error')
  })

  it('caps an error reply', async () => {
    const { error } = JSON.parse(await forged('requestTool', { ok: false, error: 'x'.repeat(100_000) }))
    expect(error.message.length).toBeLessThan(4100)
  })

  it('turns a result that is not a string into a tool error', async () => {
    for (const value of [{ x: 1n }, 42, null, undefined, ['a']]) {
      expect(JSON.parse(await forged('requestTool', { ok: true, value })).error.name).toBe('EvaluatorError')
    }
  })

  it('replaces a result over the size limit', async () => {
    const { error } = JSON.parse(await forged('requestTool', { ok: true, value: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1) }))
    expect(error.name).toBe('ToolResultTooLarge')
    expect(await forged('requestTool', { ok: true, value: 'x'.repeat(MAX_TOOL_RESULT_BYTES) })).toHaveLength(MAX_TOOL_RESULT_BYTES)
  })

  it('grades nothing for a grade that is malformed, not data, or too large', async () => {
    const none = { measure: null, solid: null, params: [] }
    for (const value of [null, 'x', { measure: 1, solid: null, params: [] }, { measure: null, solid: null, params: {} }, { measure: { v: 1n }, solid: null, params: [] }, { measure: { big: 'x'.repeat(2e6) }, solid: null, params: [] }]) {
      expect(await forged('gradeProject', { ok: true, value })).toEqual(none)
    }
    expect(await forged('gradeProject', { ok: false, error: 'x' })).toEqual(none)
  })

  it('keeps a well-formed grade as plain data', async () => {
    const graded = await forged('gradeProject', { ok: true, value: { measure: { volume: 8000, extra: NaN, when: new Map() }, solid: { watertight: true }, params: [] } })
    expect(graded).toEqual({ measure: { volume: 8000, extra: null, when: {} }, solid: { watertight: true }, params: [] })
  })

  it('passes a probe to the backend and keeps its answer, or null when it is not an object', async () => {
    const { client, server } = transportPair()
    const seen = []
    serveExecutor(server, () =>
      fakeBackend({
        gradeProject: async (model, options) => {
          seen.push(options)
          return { measure: null, solid: null, params: [], probe: { sections: [] } }
        },
      }),
    )
    const executor = createExecutorClient(client, { api: 'fluent' })
    const probe = { sections: [{ axis: 'z', at: [0.5] }] }
    expect((await executor.gradeProject({ files: {}, entry: 'main.js' }, { timeoutMs: 1000, probe })).probe).toEqual({ sections: [] })
    expect(seen).toEqual([{ timeoutMs: 1000, probe }])
    expect((await forged('gradeProject', { ok: true, value: { measure: null, solid: null, params: [], probe: 'x' } })).probe).toBeNull()
  })

  it('takes a reset reply only as a plain JSON record, else null', async () => {
    const replying = async (reply) => {
      const { client } = transportPair()
      const handlers = []
      const executor = createExecutorClient({ ...client, onMessage: (fn) => handlers.push(fn) }, { api: 'fluent' })
      const reset = executor.reset({})
      for (const fn of handlers) fn({ type: 'reply', id: 0, ...reply })
      return reset
    }
    expect(await replying({ ok: false, error: 'empty provider reply' })).toBeNull()
    expect(await replying({ ok: true, value: 'x' })).toBeNull()
    expect(await replying({ ok: true, value: { ok: true, pad: 'x'.repeat(MAX_TOOL_RESULT_BYTES) } })).toBeNull()
    expect(await replying({ ok: true, value: { ok: true, entry: 'main.js' } })).toEqual({ ok: true, entry: 'main.js' })
  })

  it('kill the executor on any frame that answers no outstanding request', async () => {
    const stray = [
      { type: 'reply', id: 999, ok: true, value: 'x' },
      { type: 'ready' },
      { type: 'call', id: 0 },
      { type: 'noise' },
      42,
      null,
      [1],
    ]
    for (const message of stray) {
      const { client, killed, exit } = transportPair()
      const handlers = []
      const executor = createExecutorClient({ ...client, onMessage: (fn) => handlers.push(fn) }, { api: 'fluent' })
      for (const fn of handlers) fn({ type: 'ready' })
      const pending = executor.requestTool('run', {})
      for (const fn of handlers) fn(message)
      expect(killed()).toBe(true)
      exit('signal SIGKILL')
      await expect(pending).rejects.toThrow(/executor exited: the executor sent a frame that answers no request/)
    }
  })

  it('accept exactly one ready and one reply per call', async () => {
    const { client, killed } = transportPair()
    const handlers = []
    const executor = createExecutorClient({ ...client, onMessage: (fn) => handlers.push(fn) }, { api: 'fluent' })
    for (const fn of handlers) fn({ type: 'ready' })
    const answer = executor.requestTool('run', {})
    for (const fn of handlers) fn({ type: 'reply', id: 0, ok: true, value: 'fine' })
    expect(await answer).toBe('fine')
    expect(killed()).toBe(false)
    for (const fn of handlers) fn({ type: 'reply', id: 0, ok: true, value: 'again' })
    expect(killed()).toBe(true)
  })
})

