// The executor (eval/sandbox.js startExecutor): one eval backend answering
// the conversation process's calls in frames (eval/frames.js) on fd 3, a
// socket the parent created. The backend keeps module-level and globalThis
// state, so each conversation gets its own process.
import { registerHooks } from 'node:module'
import { Socket } from 'node:net'
import { createFrameReader, encodeFrame } from './frames.js'

const CHANNEL_FD = 3
const MAX_REQUEST_BYTES = 64 * 1024 * 1024

const channel = new Socket({ fd: CHANNEL_FD, readable: true, writable: true })
channel.on('end', () => process.exit(0))
channel.on('error', () => process.exit(0))

const queued = []
let deliver = (message) => queued.push(message)
channel.on(
  'data',
  createFrameReader({
    maxBytes: MAX_REQUEST_BYTES,
    onFrame: (message) => deliver(message),
    onViolation: () => process.exit(2),
  }),
)

// Model code's dynamic import() reaches Node's loader with the require
// evaluator as its parent; the frame has no such loader.
const EVALUATOR = import.meta.resolve('@jscadui/require/esm/index.js')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === EVALUATOR) throw new Error(`failed to load module ${specifier}`)
    return nextResolve(specifier, context)
  },
})

const { createEvalBackend } = await import('./backend.js')
const { serveExecutor } = await import('./executor-protocol.js')

const send = (message) => {
  let frame
  try {
    frame = encodeFrame(message)
  } catch (error) {
    frame = encodeFrame({ type: 'reply', id: message.id, ok: false, error: `unserializable reply: ${error.message}` })
  }
  channel.write(frame)
}

serveExecutor(
  {
    send,
    onMessage: (fn) => {
      deliver = fn
      for (const message of queued.splice(0)) fn(message)
    },
  },
  createEvalBackend,
)
