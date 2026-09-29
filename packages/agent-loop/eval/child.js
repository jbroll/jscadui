// A sandboxed child process (eval/sandbox.js): one eval conversation, or a
// grader serving gradeProject requests. The backend keeps module-level and
// globalThis state, so each conversation gets its own process.
import { registerHooks } from 'node:module'

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
const { loadFixtures, runConversation } = await import('./run-eval.js')
const { formatRunHeader, formatText, formatToolCall, formatToolResult } = await import('./verbose.js')

const send = (message) => new Promise((resolve) => process.send(message, resolve))

const conversation = async ({ fixtureName, run, runs, maxTurns, provider: providerConfig, providerModule = '../index.js' }) => {
  const log = (text) => send({ type: 'log', text })
  const fixture = (await loadFixtures()).find((f) => f.name === fixtureName)
  if (!fixture) throw new Error(`no fixture named ${fixtureName}`)
  const { createProvider } = await import(providerModule)

  let pending = ''
  const flush = () => {
    if (pending) log(formatText(pending))
    pending = ''
  }

  log(formatRunHeader(fixture, run, runs))
  const result = await runConversation(fixture, run, {
    provider: createProvider(providerConfig),
    backend: createEvalBackend(),
    maxTurns,
    onToolCall: (name, input) => {
      flush()
      log(formatToolCall(name, input))
    },
    onToolResult: (_name, output) => log(formatToolResult(output)),
    onText: (text) => {
      pending += text
    },
  })
  flush()
  await send({ type: 'result', result })
  process.exit(0)
}

const grader = () => {
  const backend = createEvalBackend()
  process.on('message', async (message) => {
    if (message.type !== 'grade') return
    const graded = await backend.gradeProject(message.model)
    send({ type: 'graded', id: message.id, graded })
  })
  send({ type: 'ready' })
}

process.once('message', (message) => {
  if (message.type === 'conversation') conversation(message.data)
  if (message.type === 'grade-server') grader()
})
