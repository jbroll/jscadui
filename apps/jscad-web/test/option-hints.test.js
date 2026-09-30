import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { expectCase, WARNING_CASES } from '@jscadui/agent-loop/test/warningCases.js'
import index from '@jscadui/agent-loop/api/index.json'
import { createProjectTools } from '../src/aiDeps.js'
import { createProjectBuilds } from '../src/projectBuild.js'
import { installOptionWarnings } from '../src_frame/optionWarnings.js'

const nodeRequire = createRequire(import.meta.url)

// The frame worker's side of a chat run: jscadSetFiles hands the collector the
// chat's api as bundle.frame-worker.js does, and jscadScript runs the model
// through the option-checked module copies. A load throws its error; a scratch
// run answers it, as the worker does.
const frameWorker = () => {
  let wrapper
  let collector
  installOptionWarnings({ setUserModuleWrapper: (fn) => { wrapper = fn }, setRunWarnings: (c) => { collector = c } })
  const load = async (script) => {
    collector.reset()
    const module = { exports: {} }
    new Function('require', 'module', 'exports', script)((spec) => wrapper(spec, nodeRequire(spec)), module, module.exports)
    await module.exports.main()
    return { warnings: collector.list() }
  }
  return {
    jscadSetFiles: vi.fn(async ({ api }) => collector.setApi(api)),
    jscadScript: async ({ script, scratch }) => {
      if (!scratch) return load(script)
      try {
        return { scratch: true, console: [], ...(await load(script)) }
      } catch (error) {
        return { scratch: true, console: [], warnings: collector.list(), error: { name: error.name, message: error.message, stack: error.stack } }
      }
    },
  }
}

describe('app warnings and error hints follow the chat api', () => {
  for (const c of WARNING_CASES) {
    it(`run: ${c.name}`, async () => {
      const worker = frameWorker()
      const tools = createProjectTools({ getProjectFiles: async () => ({}), workerApi: worker, getApi: () => c.api, loadIndex: async () => index })
      const res = await tools.run(c.source)
      expect(worker.jscadSetFiles).toHaveBeenCalledWith({ files: { '__run__.js': c.source }, api: c.api })
      expectCase(expect, c, res)
    })

    it(`build: ${c.name}`, async () => {
      const worker = frameWorker()
      await worker.jscadSetFiles({ files: {}, api: c.api })
      const builds = createProjectBuilds({ measure: async () => ({ boundingBox: [[0, 0, 0], [1, 1, 1]], dimensions: [1, 1, 1] }), check: async () => ({}), getApi: () => c.api, loadIndex: async () => index })
      const outcome = await worker.jscadScript({ script: c.source }).then((result) => ({ result }), (error) => ({ error }))
      builds.recordLoad('http://project.local/main.js', outcome)
      expectCase(expect, c, await builds.report())
    })
  }
})
