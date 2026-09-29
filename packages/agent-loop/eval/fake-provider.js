// Test-only provider module for eval/parallel.test.js: runInChild loads it in
// place of ../index.js so a sandboxed conversation runs with no network.
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

const probeRounds = () => [
  [{ type: 'tool_use', id: 't1', name: 'eval', input: { source: SANDBOX_PROBE } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

const rounds = () => [
  [{ type: 'text', text: 'building it' }, { type: 'tool_use', id: 't1', name: 'eval', input: { source: KEYLESS_SOURCES['cube-hole'] } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't2', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't3', name: 'writeModel', input: { source: KEYLESS_SOURCES['cube-hole'] } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

export const createProvider = (config) => {
  if (config.model === 'exit') process.exit(3)
  const script = config.model === 'sandbox-probe' ? probeRounds() : rounds()
  return {
    async *send() {
      if (config.model === 'fail') throw new Error('status 500')
      for (const event of script.shift() ?? []) yield event
    },
  }
}
