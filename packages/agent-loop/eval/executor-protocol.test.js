import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { createExecutorClient, serveExecutor } from './executor-protocol.js'

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
  reset: () => undefined,
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
    expect(await executor.reset({ 'main.js': 'x' })).toBeUndefined()
    expect(JSON.parse(await executor.requestTool('eval', { source: 's' }))).toEqual({ name: 'eval', input: { source: 's' } })
    expect(await executor.gradeProject({ files: {}, entry: 'main.js' })).toEqual({ measure: { model: { files: {}, entry: 'main.js' } }, solid: null, params: [] })
  })

  it('runs a real eval backend behind the protocol', async () => {
    const { client, server } = transportPair()
    serveExecutor(server, createEvalBackend)
    const executor = createExecutorClient(client, { api: 'fluent' })
    const source = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 10 })] }'
    await executor.reset({})
    expect(JSON.parse(await executor.requestTool('eval', { source })).ok).toBe(true)
    expect(JSON.parse(await executor.requestTool('measure', {})).volume).toBeCloseTo(1000, 0)
  })

  it('rejects a call the backend throws on, with its message', async () => {
    const { client, server } = transportPair()
    serveExecutor(server, () =>
      fakeBackend({
        requestTool: async () => {
          throw new Error('boom')
        },
      }),
    )
    const executor = createExecutorClient(client, { api: 'fluent' })
    await expect(executor.requestTool('eval', {})).rejects.toThrow('boom')
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
    const slow = executor.requestTool('eval', {})
    expect(await executor.gradeProject(null)).toEqual({ measure: { model: null }, solid: null, params: [] })
    release()
    expect(await slow).toBe('slow')
  })

  it('rejects pending and later calls once the executor exits', async () => {
    const { client, server, exit } = transportPair()
    serveExecutor(server, () => fakeBackend({ requestTool: () => new Promise(() => {}) }))
    const executor = createExecutorClient(client, { api: 'fluent' })
    await executor.ready
    const pending = executor.requestTool('eval', {})
    exit('code 3')
    await expect(pending).rejects.toThrow('executor exited: code 3')
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
})
