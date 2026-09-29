import { describe, expect, it, vi } from 'vitest'
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

const fakeEditor = () => ({ setSource: vi.fn() })

const MAIN_V1 = 'module.exports = { main: () => [1] }'
const MAIN_V2_USES_HELPER = "const { n } = require('./helpers.js')\nmodule.exports = { main: () => [n] }"
const HELPER_V1 = 'module.exports = { n: 1 }'
const HELPER_V2 = 'module.exports = { n: 2 }'
const NO_MAIN = 'module.exports = { n: 1 }'

const deps = () => createSavedDeps({ workerApi: fakeFrame(), handleEntities: vi.fn(), editor: fakeEditor(), recordEdit: vi.fn(async () => {}) })

describe('createSavedDeps: saved across a multi-file project', () => {
  it('a fresh eval is unsaved, and measure/check report it', async () => {
    const d = deps()
    const evalRes = await d.evaluate(MAIN_V1, 'main.js')
    expect(evalRes.saved).toBe(false)
    expect((await d.measure({})).saved).toBe(false)
    expect((await d.check({})).saved).toBe(false)
  })

  it('writing the evaluated source makes it saved', async () => {
    const d = deps()
    await d.evaluate(MAIN_V1, 'main.js')
    await d.save(MAIN_V1, 'main.js')
    expect((await d.measure({})).saved).toBe(true)
  })

  it('writing a helper the entry does not use yet leaves the saved entry saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    expect((await d.measure({})).saved).toBe(true)
  })

  it('write helper, then eval an unsaved entry draft that uses it: measure reports unsaved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    const evalRes = await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    expect(evalRes.saved).toBe(false)
    expect((await d.measure({})).saved).toBe(false)
  })

  it('writing the entry draft makes it saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(MAIN_V2_USES_HELPER, 'main.js')
    expect((await d.measure({})).saved).toBe(true)
  })

  // writeModel re-validates by re-running the project's real entry (like the
  // harness's writeModel does for every write), so editing a helper the entry
  // depends on keeps `saved` true: what's rendered now genuinely is what's
  // saved. `saved` only reads false for a file an eval used that has since
  // diverged from a save *without* an intervening re-validating write —
  // covered at the tracker level in aiSaveTracker.test.js.
  it('editing a helper the entry uses re-validates against the entry and stays saved', async () => {
    const d = deps()
    await d.save(MAIN_V1, 'main.js')
    await d.save(HELPER_V1, 'helpers.js')
    await d.evaluate(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(MAIN_V2_USES_HELPER, 'main.js')
    await d.save(HELPER_V2, 'helpers.js')
    expect((await d.measure({})).saved).toBe(true)
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
    expect((await d.measure({})).saved).toBe(true)
  })
})

describe('createSavedDeps: api style', () => {
  it('sends the chat api with the files on eval and save, and hints a thrown error in that api', async () => {
    const workerApi = fakeFrame()
    const d = createSavedDeps({ workerApi, handleEntities: vi.fn(), editor: fakeEditor(), recordEdit: vi.fn(async () => {}), getApi: () => 'modeling' })
    const res = await d.evaluate('module.exports = { main: () => [{}.translate([1, 0, 0])] }', 'main.js')
    expect(res.error.message).toContain('use transforms.translate(offset, shape)')
    await d.save(MAIN_V1, 'main.js')
    expect(workerApi.jscadSetFiles.mock.calls.map(([args]) => args.api)).toEqual(['modeling', 'modeling'])
  })
})
