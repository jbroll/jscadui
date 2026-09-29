// The executor (eval/sandbox.js startExecutor): one eval backend answering
// the conversation process's calls over IPC. The backend keeps module-level
// and globalThis state, so each conversation gets its own process.
import { registerHooks } from 'node:module'

const queued = []
let deliver = (message) => queued.push(message)
process.on('message', (message) => deliver(message))
process.on('disconnect', () => process.exit(0))

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

serveExecutor(
  {
    send: (message) => process.send(message),
    onMessage: (fn) => {
      deliver = fn
      for (const message of queued.splice(0)) fn(message)
    },
  },
  createEvalBackend,
)
