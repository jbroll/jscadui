// Request/response between the eval's conversation process, which holds the
// provider key, and the sandboxed executor that runs model code. A transport is
// { send(message), onMessage(fn), onExit?(fn), kill?() }; the executor side
// needs only send and onMessage. Model code shares the executor's process and
// can send replies of its own, so the client trusts no reply's shape.
import { GRADE_TIMEOUT_MS } from './grade.js'

const METHODS = new Set(['reset', 'requestTool', 'gradeProject'])

export const MAX_TOOL_RESULT_BYTES = 256 * 1024
export const MAX_ERROR_CHARS = 4000
const MAX_GRADE_BYTES = 1024 * 1024
// A reply frame larger than any valid reply is refused before it is read.
export const MAX_REPLY_BYTES = MAX_GRADE_BYTES + 64 * 1024
const MAX_REASON_CHARS = 500

export const NO_GRADE = () => ({ measure: null, solid: null, params: [] })

export const toolError = (name, message) => JSON.stringify({ ok: false, error: { name, message } })

const capped = (text, max) => (text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text)

// The executor ended while a call was outstanding (model code exited, was
// killed, or ran past a call's time limit).
export class ExecutorExited extends Error {
  constructor(reason) {
    super(reason ? `executor exited: ${reason}` : 'executor exited')
    this.reason = capped(reason ?? '', MAX_REASON_CHARS)
  }
}

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

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Plain JSON data (no BigInt, Map, NaN or cycles) of at most `maxBytes`, or undefined.
const jsonData = (value, maxBytes) => {
  try {
    const text = JSON.stringify(value)
    if (text === undefined || text.length > maxBytes) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const toolReply = (message) => {
  if (!message.ok) {
    const error = typeof message.error === 'string' ? message.error : 'malformed executor error'
    return toolError('EvaluatorError', capped(error, MAX_ERROR_CHARS))
  }
  if (typeof message.value !== 'string') return toolError('EvaluatorError', 'the evaluator returned a malformed tool result')
  const bytes = Buffer.byteLength(message.value)
  if (bytes > MAX_TOOL_RESULT_BYTES) {
    return toolError('ToolResultTooLarge', `the tool result was ${bytes} bytes, over the ${MAX_TOOL_RESULT_BYTES}-byte limit`)
  }
  return message.value
}

const gradeReply = (message) => {
  const data = message.ok ? jsonData(message.value, MAX_GRADE_BYTES) : undefined
  if (!isRecord(data)) return NO_GRADE()
  const { measure, solid, params } = data
  if (!(measure === null || isRecord(measure)) || !(solid === null || isRecord(solid)) || !Array.isArray(params)) return NO_GRADE()
  return { measure, solid, params }
}

const REPLIES = { reset: () => undefined, requestTool: toolReply, gradeProject: gradeReply }

// The eval backend's interface (reset, requestTool, gradeProject), every method
// async. requestTool always resolves with a string and gradeProject with a
// grade; a call rejects only with ExecutorExited. A grade gets `graceMs` past
// its own timeout: model code stuck in a synchronous loop never lets the
// executor's timer fire, so the client kills it and grades nothing.
export const createExecutorClient = (transport, { api, graceMs = 10_000 }) => {
  const pending = new Map()
  let nextId = 0
  let exited = null
  let killReason = null
  let markReady
  let failReady
  const ready = new Promise((resolve, reject) => {
    markReady = resolve
    failReady = reject
  })
  ready.catch(() => {})

  const kill = (reason) => {
    killReason ??= reason
    transport.kill?.()
  }

  // Only the first ready and one reply per outstanding call are expected;
  // anything else is model code writing to the channel, so the executor ends
  // at its first stray frame and a flood costs the parent one frame.
  let isReady = false
  transport.onMessage((message) => {
    if (message?.type === 'ready' && !isReady) {
      isReady = true
      markReady(api)
      return
    }
    const call = message?.type === 'reply' ? pending.get(message.id) : undefined
    if (!call) return kill('the executor sent a frame that answers no request')
    pending.delete(message.id)
    call.resolve(REPLIES[call.method](message))
  })
  transport.onExit?.((reason) => {
    if (exited) return
    exited = new ExecutorExited(killReason ?? reason)
    failReady(exited)
    for (const call of pending.values()) call.reject(exited)
    pending.clear()
  })

  const call = (method, args, { timeoutMs } = {}) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited)
      const id = nextId++
      let timer
      const settle = (fn) => (value) => {
        clearTimeout(timer)
        fn(value)
      }
      pending.set(id, { method, resolve: settle(resolve), reject: settle(reject) })
      if (timeoutMs) timer = setTimeout(() => kill(`ran past ${timeoutMs / 1000} s`), timeoutMs)
      transport.send({ type: 'call', id, method, args })
    })

  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS } = {}) => {
    let timer
    const gaveUp = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs + graceMs, null)
    })
    try {
      const graded = await Promise.race([call('gradeProject', [model, { timeoutMs }]), gaveUp])
      if (graded !== null) return graded
      kill(`grading ran past ${(timeoutMs + graceMs) / 1000} s`)
      return NO_GRADE()
    } finally {
      clearTimeout(timer)
    }
  }

  transport.send({ type: 'init', api })
  return {
    ready,
    reset: (files) => call('reset', [files]),
    requestTool: (name, input, { timeoutMs } = {}) => call('requestTool', [name, input], { timeoutMs }),
    gradeProject,
    alive: () => !exited,
    close: () => kill('closed'),
  }
}
