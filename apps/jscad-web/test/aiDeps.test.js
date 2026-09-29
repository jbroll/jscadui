import { describe, expect, it, vi } from 'vitest'
import index from '@jscadui/agent-loop/api/index.json'
import { NOT_SAVED } from '@jscadui/agent-loop'
import { createSavedDeps } from '../src/aiDeps.js'

// A minimal but real CommonJS runner over whatever files jscadSetFiles last
// received, so multi-file require() and "no main" are genuinely exercised —
// the same shape of fake the eval harness's own tests use for the real thing.
const fakeFrame = () => {
  let files = {}
  const run = (source) => {
    const mod = { exports: {} }
    const req = (spec) => {
      const rel = spec.replace(/^\.\//, '')
      if (!Object.hasOwn(files, rel)) throw new Error(`file not found ${rel}`)
      return run(files[rel])
    }
    new Function('module', 'exports', 'require', source)(mod, mod.exports, req)
    return mod.exports
  }
  const jscadScript = vi.fn(async ({ script }) => {
    const exports = run(script)
    if (typeof exports.main !== 'function') {
      return { scratch: true, console: [], message: 'no main(): nothing rendered, current model unchanged' }
    }
    return { entities: [exports.main()].flat(Infinity) }
  })
  return {
    jscadSetFiles: vi.fn(async ({ files: f }) => { files = f }),
    jscadScript,
    jscadMeasure: vi.fn(async () => ({ ok: true, volume: 1 })),
    jscadCheck: vi.fn(async () => ({ ok: true, watertight: true })),
  }
}

// The open project as main.js sees it: the files every run sends the frame,
// and the entry the editor runs. `open` is a project switch.
const fakeProject = (initial = {}, initialEntry) => {
  let files = { ...initial }
  let entry = initialEntry
  return {
    getProjectFiles: async () => ({ ...files }),
    writeProjectFile: async (path, source) => {
      files[path] = source
    },
    getProjectEntry: () => entry,
    open: (next, nextEntry) => {
      files = { ...next }
      entry = nextEntry
    },
    files: () => files,
  }
}

const fakeEditor = () => ({ setSource: vi.fn() })

const MAIN_V1 = 'module.exports = { main: () => [1] }'
const MAIN_V2_USES_HELPER = "const { n } = require('./helpers.js')\nmodule.exports = { main: () => [n] }"
const HELPER_V1 = 'module.exports = { n: 1 }'
const HELPER_V2 = 'module.exports = { n: 2 }'
const NO_MAIN = 'module.exports = { n: 1 }'

const deps = ({ project = fakeProject(), workerApi = fakeFrame(), handleEntities = vi.fn(), ...rest } = {}) =>
  createSavedDeps({
    workerApi,
    handleEntities,
    editor: fakeEditor(),
    recordEdit: vi.fn(async () => {}),
    getProjectFiles: project.getProjectFiles,
    writeProjectFile: project.writeProjectFile,
    getProjectEntry: project.getProjectEntry,
    ...rest,
  })

const lastScript = (workerApi) => workerApi.jscadScript.mock.calls.at(-1)[0]
const lastDrawn = (handleEntities) => handleEntities.mock.calls.at(-1)[0].entities

describe('createSavedDeps: saved across a multi-file project', () => {
  it('a fresh eval is unsaved, and measure/check report it', async () => {
    const d = deps()
    const evalRes = await d.evaluate(MAIN_V1, 'main.js')
    expect(evalRes.notSaved).toBe(NOT_SAVED)
    expect((await d.measure({})).notSaved).toBe(NOT_SAVED)
    expect((await d.check({})).notSaved).toBe(NOT_SAVED)
  })

  it('says nothing about saving before the agent evaluates anything, as the open project is its own saved model', async () => {
    const d = deps({ project: fakeProject({ 'main.js': MAIN_V1 }, 'main.js') })
    expect(await d.measure({})).not.toHaveProperty('notSaved')
    expect(await d.check({})).not.toHaveProperty('notSaved')
  })

  it('a scratch run after an unsaved eval says the model is not saved', async () => {
    const d = deps()
    expect(await d.evaluate(NO_MAIN, 'main.js')).not.toHaveProperty('notSaved')
    await d.evaluate(MAIN_V1, 'main.js')
    expect((await d.evaluate(NO_MAIN, 'scratch.js')).notSaved).toBe(NOT_SAVED)
    await d.save(MAIN_V1, 'main.js')
    expect(await d.evaluate(NO_MAIN, 'scratch.js')).not.toHaveProperty('notSaved')
  })

  it('writing the evaluated source makes it saved', async () => {
    const d = deps()
    await d.evaluate(MAIN_V1, 'main.js')
    await d.save(MAIN_V1, 'main.js')
    expect(await d.measure({})).not.toHaveProperty('notSaved')
  })

  it('writing a helper the entry does not use yet leaves the saved entry saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    expect(await d.measure({})).not.toHaveProperty('notSaved')
  })

  it('write helper, then eval an unsaved entry draft that uses it: measure reports unsaved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    const evalRes = await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    expect(evalRes.notSaved).toBe(NOT_SAVED)
    expect((await d.measure({})).notSaved).toBe(NOT_SAVED)
  })

  it('writing the entry draft makes it saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(MAIN_V2_USES_HELPER, 'main.js')
    expect(await d.measure({})).not.toHaveProperty('notSaved')
  })

  it('editing a helper the entry uses re-validates against the entry and stays saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(HELPER_V2, 'helpers.js')
    expect(await d.measure({})).not.toHaveProperty('notSaved')
  })

  it('a file the eval used that changes in the project reads unsaved', async () => {
    const project = fakeProject({ 'main.js': MAIN_V2_USES_HELPER, 'helpers.js': HELPER_V1 }, 'main.js')
    const d = deps({ project })
    expect(await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')).not.toHaveProperty('notSaved')
    await project.writeProjectFile('helpers.js', HELPER_V2)
    expect((await d.measure({})).notSaved).toBe(NOT_SAVED)
  })
})

describe('createSavedDeps: the open project', () => {
  it("evaluates against the project's files", async () => {
    const project = fakeProject({ 'main.js': MAIN_V1, 'helpers.js': HELPER_V2 }, 'main.js')
    const d = deps({ project })
    expect(await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')).toMatchObject({ entityCount: 1 })
  })

  it("writes into the project's files, where the editor's next run reads them", async () => {
    const project = fakeProject({ 'main.js': MAIN_V1 }, 'main.js')
    await deps({ project }).save(HELPER_V1, 'helpers.js')
    expect(project.files()).toEqual({ 'main.js': MAIN_V1, 'helpers.js': HELPER_V1 })
  })

  it("validates a helper write in an existing project through the project's main.js", async () => {
    const project = fakeProject({ 'main.js': MAIN_V2_USES_HELPER, 'helpers.js': HELPER_V1 }, 'main.js')
    const workerApi = fakeFrame()
    const handleEntities = vi.fn()
    const d = deps({ project, workerApi, handleEntities })
    expect(await d.save(HELPER_V2, 'helpers.js')).toEqual({ ok: true, entry: 'helpers.js' })
    expect(lastScript(workerApi).script).toBe(MAIN_V2_USES_HELPER)
    expect(lastDrawn(handleEntities)).toEqual([2])
  })

  it("validates a helper write through the project's declared entry when it has no main.js", async () => {
    const entry = "const { n } = require('./gear.js')\nmodule.exports = { main: () => [n] }"
    const project = fakeProject({ 'index.js': entry, 'gear.js': HELPER_V1 }, 'index.js')
    const workerApi = fakeFrame()
    const d = deps({ project, workerApi })
    await d.save(HELPER_V2, 'gear.js')
    expect(lastScript(workerApi).url).toMatch(/index\.js$/)
  })

  it("after a project switch, a write runs the new project, never the old one's main.js", async () => {
    const project = fakeProject({ 'main.js': MAIN_V1 }, 'main.js')
    const workerApi = fakeFrame()
    const handleEntities = vi.fn()
    const d = deps({ project, workerApi, handleEntities })
    await d.save(MAIN_V1, 'main.js')

    const bMain = "const { n } = require('./part.js')\nmodule.exports = { main: () => [n * 10] }"
    project.open({ 'main.js': bMain, 'part.js': HELPER_V1, 'other.js': '' }, 'main.js')
    await d.save(HELPER_V2, 'part.js')

    expect(lastScript(workerApi).script).toBe(bMain)
    expect(workerApi.jscadSetFiles.mock.calls.at(-1)[0].files).toEqual({ 'main.js': bMain, 'part.js': HELPER_V2, 'other.js': '' })
    expect(lastDrawn(handleEntities)).toEqual([20])
  })

  it('an eval saved in one project reads unsaved after switching to another', async () => {
    const project = fakeProject({}, 'main.js')
    const d = deps({ project })
    await d.evaluate(MAIN_V1, 'main.js')
    await d.save(MAIN_V1, 'main.js')
    expect(await d.measure({})).not.toHaveProperty('notSaved')
    project.open({ 'main.js': MAIN_V2_USES_HELPER, 'helpers.js': HELPER_V1 }, 'main.js')
    expect((await d.measure({})).notSaved).toBe(NOT_SAVED)
  })
})

describe('createSavedDeps: writeModel parity with the eval harness', () => {
  it('fails to save an entry with no main(), with the harness error text', async () => {
    const d = deps()
    await expect(d.save(NO_MAIN, 'main.js')).rejects.toThrow('model exports no main()')
  })

  it('fails when the written entry imports a file that does not exist yet, like the harness', async () => {
    const d = deps()
    await expect(d.save(MAIN_V2_USES_HELPER, 'main.js')).rejects.toThrow('file not found helpers.js')
  })

  it('persists a write that fails validation, so writing the missing helper next re-runs and succeeds', async () => {
    const d = deps()
    await expect(d.save(MAIN_V2_USES_HELPER, 'main.js')).rejects.toThrow('file not found helpers.js')
    const res = await d.save(HELPER_V1, 'helpers.js')
    expect(res).toEqual({ ok: true, entry: 'helpers.js' })
    expect(await d.measure({})).not.toHaveProperty('notSaved')
  })

  it("answers with the run's warnings and console", async () => {
    const warnings = [{ fn: 'primitives.cuboid', option: 'radius', suggestions: ['roundRadius'] }]
    const workerApi = {
      jscadSetFiles: vi.fn(async () => {}),
      jscadScript: vi.fn(async () => ({ entities: [{}], warnings, console: ['hi'] })),
    }
    const res = await deps({ workerApi }).save(MAIN_V1, 'main.js')
    expect(res).toEqual({ ok: true, entry: 'main.js', warnings, console: ['hi'] })
  })
})

describe('createSavedDeps: api style', () => {
  it('sends the chat api with the files on eval and save, and hints a thrown error in that api', async () => {
    const workerApi = fakeFrame()
    const d = deps({ workerApi, getApi: () => 'modeling', loadIndex: async () => index })
    const res = await d.evaluate('module.exports = { main: () => [{}.translate([1, 0, 0])] }', 'main.js')
    expect(res.error.message).toContain('use transforms.translate(offset, shape)')
    await d.save(MAIN_V1, 'main.js')
    expect(workerApi.jscadSetFiles.mock.calls.map(([args]) => args.api)).toEqual(['modeling', 'modeling'])
  })
})
