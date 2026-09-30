// Test-only scripted provider for eval/executor.test.js and
// eval/sandbox-crt.test.js: a conversation with an executor and no network.
import { KEYLESS_SOURCES } from './keyless.js'

// Model code that tries every way out of the sandbox and reports only error
// codes, never what it read.
const SANDBOX_PROBE = `const out = []
const attempt = (name, f) => { try { f(); out.push(name + ':OK') } catch (e) { out.push(name + ':' + (e.code ?? e.message)) } }
const fs = process.getBuiltinModule('fs')
const home = process.getBuiltinModule('os').homedir()
attempt('config', () => fs.readdirSync(home + '/.config'))
attempt('keys', () => { fs.readFileSync(home + '/.config/jscad-chat/keys.json') })
attempt('write', () => fs.writeFileSync(process.getBuiltinModule('os').tmpdir() + '/jscad-eval-sandbox-probe', 'x'))
attempt('spawn', () => process.getBuiltinModule('child_process').execFileSync('true'))
attempt('worker', () => new (process.getBuiltinModule('worker_threads').Worker)('0', { eval: true }))
module.exports = { main: async () => {
  try { await import('node:fs'); out.push('import:OK') } catch (e) { out.push('import:' + e.message) }
  out.push('env:' + Object.keys(process.env).join('|'))
  throw new Error(out.join(' '))
} }`

const writeRounds = (source) => [
  [{ type: 'tool_use', id: 't1', name: 'write', input: { path: 'main.js', content: source } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

const EXITS = 'module.exports = { main: () => process.exit(3) }'

const rounds = () => [
  [{ type: 'text', text: 'building it' }, { type: 'tool_use', id: 't1', name: 'write', input: { path: 'main.js', content: KEYLESS_SOURCES['cube-hole'] } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't2', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't3', name: 'check', input: {} }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

export const createProvider = (config) => {
  const script = { 'sandbox-probe': () => writeRounds(SANDBOX_PROBE), exit: () => writeRounds(EXITS) }[config.model]?.() ?? rounds()
  return {
    async *send() {
      if (config.model === 'fail') throw new Error('status 500')
      for (const event of script.shift() ?? []) yield event
    },
  }
}
