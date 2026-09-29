import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { expectCase, WARNING_CASES } from '@jscadui/agent-loop/test/warningCases.js'
import { createEvaluate } from '../src/aiEvaluate.js'
import { installOptionWarnings } from '../src_frame/optionWarnings.js'

const nodeRequire = createRequire(import.meta.url)

// The frame worker's side of an agent eval: jscadSetFiles hands the collector
// the chat's api as bundle.frame-worker.js does, and jscadScript runs the model
// through the option-checked module copies.
const frameWorker = () => {
  let wrapper
  let collector
  installOptionWarnings({ setUserModuleWrapper: (fn) => { wrapper = fn }, setRunWarnings: (c) => { collector = c } })
  return {
    jscadSetFiles: vi.fn(async ({ api }) => collector.setApi(api)),
    jscadScript: async ({ script }) => {
      collector.reset()
      const module = { exports: {} }
      new Function('require', 'module', 'exports', script)((spec) => wrapper(spec, nodeRequire(spec)), module, module.exports)
      const out = await module.exports.main()
      return { entities: [out].flat(), warnings: collector.list() }
    },
  }
}

describe('app eval warnings and error hints follow the chat api', () => {
  for (const c of WARNING_CASES) {
    it(c.name, async () => {
      const worker = frameWorker()
      const res = await createEvaluate(worker, vi.fn(), () => c.api)(c.source, 'main.js')
      expect(worker.jscadSetFiles).toHaveBeenCalledWith({ files: { 'main.js': c.source }, api: c.api })
      expectCase(expect, c, res)
    })
  }
})
