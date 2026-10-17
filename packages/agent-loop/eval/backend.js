import { readdirSync, readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, measure } from '@jscadui/model-tools'
import { createParamsProxy, createProxyState, toParamDefinitions, withProjectMains } from '@jscadui/params-core'
import { clearAllCaches, moduleResolver, require as jscadRequire, requireHandlers, setLibraryPrefixes } from '@jscadui/require/esm/index.js'
import { transformcjs } from '@jscadui/transform-babel/esm/transform-babel.js'
import * as jscadText from '@jscadui/jscad-text'
import { registerInstalledFonts } from '@jscadui/jscad-text/fontCache'
import * as jscadIo from '@jscad/io'
import { OPTION_TABLES } from '../api/optionTable.js'
import { DEFAULT_API } from '../src/api.js'
import { installConsoleCapture } from '../src/consoleCapture.js'
import { createScadHandler } from '../src/scadHandler.js'
import { shouldTransform } from '@jscadui/worker/src/shouldTransform.js'
import { docsTool } from '../src/docs.js'
import { lintSource } from '../src/lint.js'
import { dispatchTool, toolError } from '../src/dispatchTool.js'
import { reportError } from '../src/modelError.js'
import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '../src/optionChecks.js'
import { asGeometry, assembleReport, noEntryReport, noGeometryError, noMainError, summarizeRun, writeReport } from '../src/buildReport.js'
import { exportConfig, exportedSize } from '../src/exportFormat.js'
import { applyDelete, applyEdit, applyWrite, buildFiles, deleteReport, isCodePath, isTestFile, listFiles, readFile, resolveEntry } from '../src/project.js'
import { createReadFile, PROJECT_BASE, RUN_FILE } from '../src/projectUrl.js'
import { runTestFile, summarizeTestRun, TEST_API } from '../src/testPackage.js'
import { withUnits } from '../src/units.js'
import { GRADE_TIMEOUT_MS } from './grade.js'
import { collectMesh, meshPage, meshPages } from './mesh.js'
import { runProbe } from './probe.js'

const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

const staticWarnings = (diagnostics) => diagnostics.map(({ from: _from, to: _to, ...rest }) => ({ ...rest, source: 'static' }))

// The runtime option checks and the static lint see the same mistake; keep the
// runtime entry (it carries the hint) and add only what it did not report.
const mergeStatic = (result, diagnostics) => {
  if (!diagnostics.length) return result
  const runtime = result.warnings ?? []
  const covered = new Set(runtime.filter((warning) => warning.option).map((warning) => `${warning.fn}\u0000${warning.option}`))
  const added = staticWarnings(diagnostics).filter((warning) => !(warning.option && covered.has(`${warning.fn}\u0000${warning.option}`)))
  return added.length ? { ...result, warnings: [...runtime, ...added] } : result
}

export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/'
export { GRADE_TIMEOUT_MS }
const nodeRequire = createRequire(import.meta.url)

// The frame loads the static font map's fonts from the CDN; here they come
// from the same pinned npm packages in node_modules, which the sandbox binds.
const fonts = registerInstalledFonts(import.meta.url)
if (fonts.missing.length) throw new Error(`eval backend: font packages not installed (run npm install): ${fonts.missing.join(' ')}`)

// ESM-only packages the frame serves from its own bundles; Node's require
// cannot resolve an `exports` with only an `import` condition. A plain copy,
// as the frame's CJS bundle gives, since the loader adds `default` to it.
const ESM_MODULES = { '@jscadui/jscad-text': { ...jscadText } }

// The packages the frame serves model code: its worker bundles
// (apps/jscad-web/src_frame/frameHost.js workerBundles) plus the ones
// packages/require/src/require.js gives project code a wrapped copy of
// (USER_MODULES). The eval runs without either, so mirror the list here.
export const FRAME_PACKAGES = new Set([
  '@jscad/modeling',
  '@jscad/modeling-for-anchors',
  '@jscad/modeling-for-manifold',
  '@jbroll/jscad-anchors',
  '@jscad/io',
  '@jscadui/model-tools',
  '@jbroll/jscad-fluent',
  '@jscad/csg',
  '@jscadui/params-core',
  '@jscadui/jscad-text',
])

const installed = (spec) => {
  if (Object.hasOwn(ESM_MODULES, spec)) return true
  try {
    nodeRequire.resolve(spec)
    return true
  } catch {
    return false
  }
}

// What the frame could fetch from the CDN: one of its own packages and
// installed, never a Node built-in or some other installed package.
const servable = (spec) => !isBuiltin(spec) && FRAME_PACKAGES.has(spec) && installed(spec)

// Node's module object for @jscad/modeling is the one fluent's and
// model-tools' own requires get, so model code gets a wrapped copy instead.
// Fluent's classes are not exported; their methods are wrapped on the shared
// prototypes, once. The CDN stub reaches this through a global, so model code
// can call it too, and it serves nothing a CDN require would not.
const USER_MODULE = Symbol.for('jscadui.eval.userModule')
const FLUENT = '@jbroll/jscad-fluent'
const TEXT = '@jscadui/jscad-text'
const warnings = createWarningCollector({ base: PROJECT_BASE })
const wrapped = new WeakMap()
globalThis[USER_MODULE] = (spec) => {
  if (!servable(spec)) throw new Error(`failed to load module ${spec}`)
  // As the frame does: text2d works without the model's own init.
  if (spec === TEXT && !jscadText.saveState().jscad) jscadText.init(nodeRequire('@jscad/modeling'))
  const real = ESM_MODULES[spec] ?? nodeRequire(spec)
  const table = OPTION_TABLES[spec]
  if (!table) return real
  if (!wrapped.has(real)) {
    if (spec === FLUENT) wrapFluentMethods(real, table, warnings.warn)
    wrapped.set(real, withOptionChecks(real, table, warnings.warn))
  }
  return wrapped.get(real)
}

const packageSpec = (url) => url.slice(CDN_BASE.length).replace(/^((?:@[^/]+\/)?[^/@]+)@[^/]+/, '$1')

// The frame maps require('<library>/...') to the app's /libs/; with no app server here, library files come from disk.
const APP_ORIGIN = 'http://app.local'
const LIBS_PREFIX = `${APP_ORIGIN}/libs/`
const LIBS_DIR = resolvePath(process.env.JSCAD_LIBS_DIR ?? fileURLToPath(new URL('../../../apps/jscad-web/libs/', import.meta.url)))

const libraryNames = () => {
  try {
    return readdirSync(LIBS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}
setLibraryPrefixes(Object.fromEntries(libraryNames().map((name) => [`${name}/`, `${LIBS_PREFIX}${name}/`])))

// path is LIBS_PREFIX-rooted; resolving it and checking the result still
// starts with LIBS_DIR refuses a `../` that would otherwise read outside it.
const readLibFile = (path) => {
  const target = resolvePath(LIBS_DIR, decodeURIComponent(path.slice(LIBS_PREFIX.length)))
  if (target !== LIBS_DIR && !target.startsWith(LIBS_DIR + sep)) throw new Error(`file not found ${path}`)
  try {
    return readFileSync(target, 'utf8')
  } catch {
    throw new Error(`file not found ${path}`)
  }
}

// The frame fetches CDN packages; here they come from node_modules, and a
// missing one throws the text the frame's fetch gives a 404. Node resolves its
// built-ins too, which the browser has none of.
const readPackage = (path) => {
  if (path.startsWith(LIBS_PREFIX)) return readLibFile(path)
  if (path.startsWith(CDN_BASE)) {
    const spec = packageSpec(path)
    if (servable(spec)) {
      return `module.exports = globalThis[Symbol.for('jscadui.eval.userModule')](${JSON.stringify(spec)})`
    }
  }
  throw new Error(`file not found ${path}`)
}

export const createEvalReadFile = (files) => createReadFile(files, readPackage)

// Loaded on the first .scad require: executor start-up counts against the run time limit.
// The scad handler is synchronous, hence require() of the ESM entry.
const requireEsm = (spec) => nodeRequire(fileURLToPath(import.meta.resolve(spec)))

let _openscad = null
const getOpenscad = () => {
  if (!_openscad) {
    const { parse, transpile } = requireEsm('@jscadui/openscad')
    const j$ = requireEsm('@jscadui/openscad-runtime').default
    j$.init(nodeRequire('@jscad/modeling'))
    j$.setSpecialVar('$preview', true)
    globalThis.j$ = j$
    _openscad = { parse, transpile, j$ }
  }
  return _openscad
}

requireHandlers.set('scad', createScadHandler({ getOpenscad, getAppOrigin: () => APP_ORIGIN }).handle)

const modelError = (error, api) => reportError(error, { api, index: API_INDEX })

// The project's `test/` `.js` files run in-process: Node has no test-worker
// bundle, so each file goes through Task 4's `runTestFile` the way the
// browser's testRun.js does, with the identical aggregated shape. Console is
// captured and dropped — the tool result carries `{build, tests}` only. A
// throw in one file fails its own run, never the loop.
const runEvalTests = (testFiles, testApi) => {
  const names = Object.keys(testFiles).filter((path) => isTestFile(path) && typeof testFiles[path] === 'string').sort()
  const capture = installConsoleCapture()
  // Bare `test`/`assert`/`assertPart` resolve as well as `require('test')`,
  // as the browser runner sets them.
  const saved = { test: globalThis.test, assert: globalThis.assert, assertPart: globalThis.assertPart }
  globalThis.test = TEST_API.test
  globalThis.assert = TEST_API.assert
  globalThis.assertPart = TEST_API.assertPart
  try {
    let passed = 0
    let failed = 0
    const failures = []
    const assertsByPart = {}
    for (const file of names) {
      let result
      try {
        result = runTestFile(testFiles[file], { filename: file, ...(testApi === undefined ? {} : { api: testApi }) })
      } catch (error) {
        failed += 1
        failures.push({ file, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error), file } })
        continue
      }
      passed += result.passed
      failed += result.failed
      for (const [index, count] of Object.entries(result.assertsByPart)) {
        assertsByPart[index] = (assertsByPart[index] ?? 0) + count
      }
      for (const test of result.tests.filter((entry) => !entry.ok)) {
        failures.push({ file, test: test.name, error: test.error })
      }
      for (const error of result.errors) {
        failures.push({ file, error })
      }
    }
    return { ok: failed === 0, passed, failed, failures, assertsByPart, files: names }
  } finally {
    capture.restore()
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}

// Indirect eval's SyntaxError carries no location; the frame worker hits the
// same gap, so re-parse with Babel (as worker.js does), entry first, and let
// reportError read the file and line from the first parse error's message.
const locateSyntaxError = (files, entry, error) => {
  const paths = [entry, ...Object.keys(files).filter((p) => p !== entry && p.endsWith('.js')).sort()]
  for (const path of paths) {
    if (typeof files[path] !== 'string') continue
    try {
      transformcjs(files[path], PROJECT_BASE + path)
    } catch (parseError) {
      return { name: parseError?.name, message: parseError?.message }
    }
  }
  // The stack would name the require call site, not the error.
  return { name: error.name, message: error.message }
}

// Runs `entry` over `files` and, when it exports one, its main(). Never throws.
// `wrapRequire` wraps the require the entry's own code calls; `values` sets
// parameters by name, as the user's form does.
const runModel = async (files, entry, api, { wrapRequire, values = {} } = {}) => {
  // One jscad-text serves every run, so an init() a snippet made must not carry into a build.
  jscadText.reset()
  warnings.reset()
  warnings.setApi(api)
  clearAllCaches()
  moduleResolver.clearCache()
  const url = PROJECT_BASE + entry
  const source = files[entry]
  const capture = installConsoleCapture()
  const settle = (out) => ({ ...out, warnings: warnings.list(), console: capture.list() })
  try {
    if (typeof source !== 'string') throw new Error(`file not found ${url}`)
    const transform = shouldTransform(url, source) ? transformcjs : undefined
    let exports
    try {
      exports = jscadRequire({ url, script: source, wrapRequire }, transform, createEvalReadFile(files), PROJECT_BASE, PROJECT_BASE)
    } catch (e) {
      throw e?.name === 'SyntaxError' ? locateSyntaxError(files, entry, e) : e
    }
    const main = exports?.main ?? (typeof exports === 'function' ? exports : undefined)
    if (typeof main !== 'function') return settle({ exports, hasMain: false })
    const state = createProxyState(values, new Set(Object.keys(values)), { mode: 'hierarchical' })
    const value = await main(createParamsProxy(state))
    return settle({ hasMain: true, value, params: toParamDefinitions(state.discovered) })
  } catch (error) {
    return settle({ error })
  } finally {
    capture.restore()
  }
}

// The frame's serializer for the format, over the model's parts; the app
// answers { ok, format, size } without the bytes.
const exportModel = (geometry, format) => {
  const config = exportConfig(format)
  return { ok: true, format, size: exportedSize(jscadIo[config.serializerKey].serialize({ ...config.defaultOptions }, geometry)) }
}

const MAX_VARIANTS = 12

const isNumberParam = (p) => typeof p.initial === 'number' && Number.isFinite(p.initial) && !Array.isArray(p.values)

// A value 20% off the initial one inside the parameter's range, else the range's far end.
export const variantValue = ({ initial, min = -Infinity, max = Infinity, type }) => {
  const step = initial === 0 ? 1 : Math.abs(initial) * 0.2
  const tidy = (v) => (type === 'int' ? Math.round(v) : v)
  const candidates = [initial + step, initial - step, max, min].map(tidy)
  return candidates.find((v) => Number.isFinite(v) && v !== initial && v >= min && v <= max) ?? null
}

const differs = (a, b) => Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))

export function createEvalBackend({ api = DEFAULT_API, cannedSearch = [], cannedFetch = [], cannedAsk = [] } = {}) {
  let files = {}
  // The last build: its report, and its geometry and params when it built.
  let current = null
  // A build that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0
  // The last build's mesh pages, made on the first `mesh` request after it.
  let meshed = null

  const build = async (entry = resolveEntry(buildFiles(files))) => {
    const started = generation
    meshed = null
    if (!entry) {
      current = { report: noEntryReport() }
      return current.report
    }
    // The geometry builder sees the model files only: `test/` and `notes/`
    // are stripped before entry resolution and the run, so a test file can
    // never resolve as the entry or load as geometry. A test-only project
    // answers the no-entry report, gracefully.
    const modelFiles = buildFiles(files)
    const loaded = await runModel(modelFiles, entry, api)
    if (started !== generation) return null
    const error = loaded.error ? modelError(loaded.error, api) : loaded.hasMain ? undefined : noMainError(entry)
    const geometry = [loaded.value].flat(Infinity)
    const report = await assembleReport({
      entry,
      error,
      warnings: loaded.warnings,
      console: loaded.console,
      params: loaded.params,
      measure: () => measure(asGeometry(geometry)),
      check: () => check(asGeometry(geometry)),
    })
    current = report.ok ? { report, geometry, params: loaded.params } : { report }
    return report
  }

  const saved = async (next) => {
    files = next.files
    const report = await build()
    if (!report) return toolError('ResetError', 'the run was reset before the build finished')
    const diagnostics = await lintSource(API_INDEX, next.files[next.path] ?? '', { api })
    const merged = writeReport(next.path, mergeStatic(report, diagnostics))
    // The app's save answers the same shape: docs, notes and the test files
    // themselves skip tests, every other `.js` write runs the full suite.
    // A red build stays saved — the run still answers, with ok false.
    if (!isCodePath(next.path)) return merged
    const { tests, coverageNote } = summarizeTestRun(runEvalTests(files, api), merged.geometry?.parts)
    return { ...merged, ok: merged.ok && tests.ok, build: merged, tests, coverageNote }
  }

  // A delete of a file that is not there answers ok: nothing changed, nothing
  // to rebuild.
  const removed = async (next) => {
    files = next.files
    const report = await build()
    return report ? deleteReport(next.path, report) : toolError('ResetError', 'the run was reset before the build finished')
  }

  // A scratch snippet beside the project: the project, its build and its geometry stay as they were.
  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const loaded = await runModel({ ...files, [RUN_FILE]: source }, RUN_FILE, api, { wrapRequire: withProjectMains })
    const { warnings: warned, console: lines } = loaded
    const diagnostics = await lintSource(API_INDEX, source, { api })
    if (loaded.error) return mergeStatic({ ok: false, error: modelError(loaded.error, api), warnings: warned, console: lines }, diagnostics)
    const summary = summarizeRun({ hasMain: loaded.hasMain, value: loaded.hasMain ? loaded.value : loaded.exports }, measure, check)
    return mergeStatic({ ok: true, warnings: warned, console: lines, ...summary }, diagnostics)
  }

  const onBuild = (tool) => (args) => (current?.geometry ? tool(current.geometry, args) : noGeometryError(current?.report ?? null))

  // Offline websearch: scripted fixtures are consent by construction, so the
  // grant gate does not apply here. Canned results keyed by query substring;
  // anything unscripted fails closed — live network never runs in eval.
  const searchCanned = (args) => {
    const query = args?.query ?? ''
    const entry = cannedSearch.find(
      (canned) => typeof canned?.match === 'string' && query.toLowerCase().includes(canned.match.toLowerCase()),
    )
    if (!entry) return toolError('SearchUnavailableError', 'websearch: no canned result matches in the eval harness')
    return { ok: true, results: entry.results.map((hit) => ({ ...hit })) }
  }

  // Offline webfetch: canned pages keyed by URL substring, as websearch is by
  // query. Scripted fixtures are consent by construction, so no grant gate;
  // anything unscripted fails closed — live network never runs in eval.
  const fetchCanned = (args) => {
    const url = args?.url ?? ''
    const entry = cannedFetch.find(
      (canned) => typeof canned?.match === 'string' && url.toLowerCase().includes(canned.match.toLowerCase()),
    )
    if (!entry) return toolError('FetchUnavailableError', 'webfetch: no canned page matches in the eval harness')
    return {
      ok: true,
      title: entry.title ?? '',
      finalUrl: entry.finalUrl ?? url,
      content: entry.content ?? '',
      truncated: entry.truncated === true,
    }
  }

  // Offline `question`: canned answers keyed by question substring, as
  // websearch is by query. The harness cannot ask a human, so anything
  // unscripted fails closed rather than hanging the turn.
  const askCanned = (args) => {
    const question = args?.question ?? ''
    const entry = cannedAsk.find(
      (canned) => typeof canned?.match === 'string' && question.toLowerCase().includes(canned.match.toLowerCase()),
    )
    if (!entry) return toolError('AskUnavailableError', 'question: no canned answer matches in the eval harness')
    return entry.answer
  }

  const tools = {
    list: () => listFiles(files),
    read: (args) => readFile(files, args),
    write: (args) => saved(applyWrite(files, args)),
    edit: (args) => saved(applyEdit(files, args)),
    deleteFile: (args) => {
      const removal = applyDelete(files, args)
      return removal.deleted ? removed(removal) : { ok: true }
    },
    run,
    measure: onBuild((geometry, args) => withUnits({ ok: true, ...measure(asGeometry(geometry), args) })),
    check: onBuild((geometry, args) => withUnits({ ok: true, ...check(asGeometry(geometry), args) })),
    exportModel: onBuild((geometry, args) => exportModel(geometry, args.format)),
    view: () => toolError('UnavailableError', 'view is unavailable in the eval harness'),
    docs: (query) => docsTool(API_INDEX, query, { api }),
    websearch: searchCanned,
    webfetch: fetchCanned,
    askUser: askCanned,
  }

  // The executor protocol carries tool results as text.
  const requestTool = async (name, input) => {
    const out = await dispatchTool(name, input, tools)
    return typeof out === 'string' ? out : JSON.stringify(out)
  }

  const seed = (seeded = {}) => {
    generation += 1
    current = null
    meshed = null
    files = { ...seeded }
  }

  // `files` seeds the project, as a fixture's files seed the app's; with
  // `build`, a seeded project is built and its report returned (null for an empty one).
  const reset = async (seeded = {}, { build: buildNow = false } = {}) => {
    seed(seeded)
    return buildNow && Object.keys(files).length > 0 ? build() : null
  }

  // Each number parameter set to variantValue() in a rebuild of its own, with
  // what that did to the model's size and volume. A synchronous main() cannot
  // be cut short, so a rebuild starts only while twice the slowest build so
  // far still fits before `deadline`.
  const paramVariants = async (model, deadline, buildMs) => {
    const base = measure(asGeometry(current.geometry))
    const out = []
    let slowest = buildMs
    for (const param of current.params.filter(isNumberParam).slice(0, MAX_VARIANTS)) {
      const value = variantValue(param)
      const left = deadline - Date.now()
      if (left <= 2 * slowest) break
      if (value === null) continue
      const variant = { name: param.name, label: param.label, from: param.initial, to: value }
      const started = Date.now()
      let timer
      const late = new Promise((resolve) => {
        timer = setTimeout(resolve, left, null)
      })
      const loaded = await Promise.race([runModel(model.files, model.entry, api, { values: { [param.name]: value } }), late])
      clearTimeout(timer)
      slowest = Math.max(slowest, Date.now() - started)
      try {
        if (!loaded) throw new Error('timed out')
        if (loaded.error) throw loaded.error
        const { dimensions, volume } = measure(asGeometry([loaded.value].flat(Infinity)))
        const changed = dimensions.some((d, k) => differs(d, base.dimensions[k])) || differs(volume ?? 0, base.volume ?? 0)
        out.push({ ...variant, dimensions, volume, changed })
      } catch (error) {
        out.push({ ...variant, error: String(error?.message ?? error).slice(0, 200), changed: false })
      }
    }
    return out
  }

  const probed = async (spec, model, deadline, buildMs) => {
    if (!current?.geometry) return null
    const { paramVariants: wantsVariants, ...geometrySpec } = spec
    try {
      const out = runProbe(current.geometry, geometrySpec)
      return wantsVariants ? { ...out, paramVariants: await paramVariants(model, deadline, buildMs) } : out
    } catch (error) {
      console.warn('eval backend: probe failed', error)
      return null
    }
  }

  // The last build's triangles, a page at a time (eval/mesh.js).
  const mesh = async (index = 0) => {
    if (!current?.geometry) return { pages: 0, bytes: 0 }
    meshed ??= meshPages(current.geometry)
    return meshPage(meshed, index)
  }

  // Builds `{ files, entry }` (grade.js gradedModel) in a fresh state and
  // measures it, plus the fixture's `probe` when it has one.
  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS, probe, mesh: wantsMesh = false } = {}) => {
    const none = { measure: null, solid: null, params: [], ...(probe ? { probe: null } : {}) }
    seed(model?.files)
    if (!model?.entry) return none
    const started = Date.now()
    const deadline = started + timeoutMs
    let timer
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs, none)
    })
    const report = await Promise.race([build(model.entry), timedOut])
    const buildMs = Date.now() - started
    clearTimeout(timer)
    if (report === none) {
      seed()
      return none
    }
    if (!report?.ok) return none
    const measured = JSON.parse(await requestTool('measure', {}))
    const checked = JSON.parse(await requestTool('check', {}))
    const graded = { measure: measured.ok ? measured : null, solid: checked.ok ? checked : null, params: current.params }
    const withProbe = probe ? { ...graded, probe: await probed(probe, model, deadline, buildMs) } : graded
    return wantsMesh ? { ...withProbe, mesh: await collectMesh(mesh) } : withProbe
  }

  return { requestTool, reset, gradeProject, mesh, files: () => ({ ...files }), lastBuild: () => current?.report ?? null }
}
