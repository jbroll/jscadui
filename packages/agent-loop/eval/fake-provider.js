// Test-only provider module for eval/parallel.test.js: runInWorker loads it in
// place of ../index.js so a worker conversation runs with no network.
import { KEYLESS_SOURCES } from './keyless.js'

const rounds = () => [
  [{ type: 'text', text: 'building it' }, { type: 'tool_use', id: 't1', name: 'eval', input: { source: KEYLESS_SOURCES['cube-hole'] } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't2', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't3', name: 'writeModel', input: { source: KEYLESS_SOURCES['cube-hole'] } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

export const createProvider = (config) => {
  if (config.model === 'exit') process.exit(3)
  const script = rounds()
  return {
    async *send() {
      if (config.model === 'fail') throw new Error('status 500')
      for (const event of script.shift() ?? []) yield event
    },
  }
}
