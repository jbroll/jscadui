// Request/response between the eval's conversation process, which holds the
// provider key, and the sandboxed executor that runs model code. A transport is
// { send(message), onMessage(fn), onExit?(fn), kill?() }; the executor side
// needs only send and onMessage.
import { GRADE_TIMEOUT_MS } from './grade.js'

const METHODS = new Set(['reset', 'requestTool', 'gradeProject'])

const NO_GRADE = () => ({ measure: null, solid: null, params: [] })

// Each call is answered as soon as it settles, not in arrival order, so a grade
// can run while an earlier eval waits on a main() that never resolves.
export const serveExecutor = (transport, createBackend) => {
  let backend = null
  transport.onMessage(async (message) => {
    if (message?.type === 'init') {
      backend = createBackend({ api: message.api })
      transport.send({ type: 'ready', api: message.api })
      return
    }
    if (message?.type !== 'call') return
    const { id, method, args = [] } = message
    try {
      if (!METHODS.has(method)) throw new Error(`unknown method ${method}`)
      if (!backend) throw new Error('executor not initialized')
      const value = await backend[method](...args)
      transport.send({ type: 'reply', id, ok: true, value })
    } catch (error) {
      transport.send({ type: 'reply', id, ok: false, error: error?.message ?? String(error) })
    }
  })
}

// The eval backend's interface (reset, requestTool, gradeProject), every method
// async. A grade gets `graceMs` past its own timeout: model code stuck in a
// synchronous loop never lets the executor's timer fire, so the client kills
// it and grades nothing.
export const createExecutorClient = (transport, { api, graceMs = 10_000 }) => {
  const pending = new Map()
  let nextId = 0
  let exited = null
  let markReady
  let failReady
  const ready = new Promise((resolve, reject) => {
    markReady = resolve
    failReady = reject
  })
  ready.catch(() => {})

  transport.onMessage((message) => {
    if (message?.type === 'ready') markReady(message.api)
    if (message?.type !== 'reply') return
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.ok) call.resolve(message.value)
    else call.reject(new Error(message.error))
  })
  transport.onExit?.((reason) => {
    if (exited) return
    exited = new Error(reason ? `executor exited: ${reason}` : 'executor exited')
    failReady(exited)
    for (const call of pending.values()) call.reject(exited)
    pending.clear()
  })

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited)
      const id = nextId++
      pending.set(id, { resolve, reject })
      transport.send({ type: 'call', id, method, args })
    })

  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS } = {}) => {
    let timer
    const gaveUp = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs + graceMs, null)
    })
    try {
      const graded = await Promise.race([call('gradeProject', model, { timeoutMs }), gaveUp])
      if (graded !== null) return graded
      transport.kill?.()
      return NO_GRADE()
    } finally {
      clearTimeout(timer)
    }
  }

  transport.send({ type: 'init', api })
  return {
    ready,
    reset: (files) => call('reset', files),
    requestTool: (name, input) => call('requestTool', name, input),
    gradeProject,
    alive: () => !exited,
    close: () => transport.kill?.(),
  }
}
