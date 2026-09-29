// One eval conversation per worker thread: the backend keeps module-level and
// globalThis state, so concurrent conversations each need their own realm.
import { parentPort, workerData } from 'node:worker_threads'
import { createEvalBackend } from './backend.js'
import { loadFixtures, runConversation } from './run-eval.js'
import { formatRunHeader, formatText, formatToolCall, formatToolResult } from './verbose.js'

const { fixtureName, run, runs, provider: providerConfig, providerModule = '../index.js' } = workerData
const log = (text) => parentPort.postMessage({ type: 'log', text })

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
parentPort.postMessage({ type: 'result', result })
