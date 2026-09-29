import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'

const RAW = '?raw'

// registerHooks runs in this thread; register needs a hooks worker thread,
// which the eval sandbox (eval/sandbox.js) does not allow.
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(RAW)) return nextLoad(url, context)
      const text = readFileSync(new URL(url.slice(0, -RAW.length)), 'utf8')
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)}` }
    },
  })
} else {
  nodeModule.register('./text-hooks.js', import.meta.url)
}
