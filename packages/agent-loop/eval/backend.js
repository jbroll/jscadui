import { readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { check, measure } from '@jscadui/model-tools'
import { createParamsProxy, createProxyState, toParamDefinitions, withProjectMains } from '@jscadui/params-core'
import { clearAllCaches, moduleResolver, require as jscadRequire } from '@jscadui/require/esm/index.js'
import { transformcjs } from '@jscadui/transform-babel/esm/transform-babel.js'
import * as jscadText from '@jscadui/jscad-text'
import { registerInstalledFonts } from '@jscadui/jscad-text/fontCache'
import * as jscadIo from '@jscad/io'
import { OPTION_TABLES } from '../api/optionTable.js'
import { DEFAULT_API } from '../src/api.js'
import { installConsoleCapture } from '../src/consoleCapture.js'
import { shouldTransform } from '@jscadui/worker/src/shouldTransform.js'
import { docsTool } from '../src/docs.js'
import { dispatchTool, toolError } from '../src/dispatchTool.js'
import { reportError } from '../src/modelError.js'
import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '../src/optionChecks.js'
import { asGeometry, assembleReport, noEntryReport, noGeometryError, noMainError, summarizeRun, writeReport } from '../src/buildReport.js'
import { exportConfig, exportedSize } from '../src/exportFormat.js'
import { applyEdit, applyWrite, listFiles, readFile, resolveEntry } from '../src/project.js'
import { createReadFile, PROJECT_BASE, RUN_FILE } from '../src/projectUrl.js'
import { withUnits } from '../src/units.js'
import { GRADE_TIMEOUT_MS } from './grade.js'
import { runProbe } from './probe.js'

const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

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

const installed = (spec) => {
  if (Object.hasOwn(ESM_MODULES, spec)) return true
  try {
    nodeRequire.resolve(spec)
    return true
  } catch {
    return false
  }
}

// What the frame could fetch from the CDN: an installed package, never a Node built-in.
const servable = (spec) => !isBuiltin(spec) && installed(spec)

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

// The frame fetches CDN packages; here they come from node_modules, and a
// missing one throws the text the frame's fetch gives a 404. Node resolves its
// built-ins too, which the browser has none of.
const readPackage = (path) => {
  if (path.startsWith(CDN_BASE)) {
    const spec = packageSpec(path)
    if (servable(spec)) {
      return `module.exports = globalThis[Symbol.for('jscadui.eval.userModule')](${JSON.stringify(spec)})`
    }
  }
  throw new Error(`file not found ${path}`)
}

export const createEvalReadFile = (files) => createReadFile(files, readPackage)

const modelError = (error, api) => reportError(error, { api, index: API_INDEX })

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

export function createEvalBackend({ api = DEFAULT_API } = {}) {
  let files = {}
  // The last build: its report, and its geometry and params when it built.
  let current = null
  // A build that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0

  const build = async (entry = resolveEntry(files)) => {
    const started = generation
    if (!entry) {
      current = { report: noEntryReport() }
      return current.report
    }
    const loaded = await runModel(files, entry, api)
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
    return report ? writeReport(next.path, report) : toolError('ResetError', 'the run was reset before the build finished')
  }

  // A scratch snippet beside the project: the project, its build and its geometry stay as they were.
  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const loaded = await runModel({ ...files, [RUN_FILE]: source }, RUN_FILE, api, { wrapRequire: withProjectMains })
    const { warnings: warned, console: lines } = loaded
    if (loaded.error) return { ok: false, error: modelError(loaded.error, api), warnings: warned, console: lines }
    const summary = summarizeRun({ hasMain: loaded.hasMain, value: loaded.hasMain ? loaded.value : loaded.exports }, measure, check)
    return { ok: true, warnings: warned, console: lines, ...summary }
  }

  const onBuild = (tool) => (args) => (current?.geometry ? tool(current.geometry, args) : noGeometryError(current?.report ?? null))

  const tools = {
    list: () => listFiles(files),
    read: (args) => readFile(files, args),
    write: (args) => saved(applyWrite(files, args)),
    edit: (args) => saved(applyEdit(files, args)),
    run,
    measure: onBuild((geometry, args) => withUnits({ ok: true, ...measure(asGeometry(geometry), args) })),
    check: onBuild((geometry, args) => withUnits({ ok: true, ...check(asGeometry(geometry), args) })),
    exportModel: onBuild((geometry, args) => exportModel(geometry, args.format)),
    view: () => toolError('UnavailableError', 'view is unavailable in the eval harness'),
    docs: (query) => docsTool(API_INDEX, query, { api }),
  }

  // The executor protocol carries tool results as text.
  const requestTool = async (name, input) => {
    const out = await dispatchTool(name, input, tools)
    return typeof out === 'string' ? out : JSON.stringify(out)
  }

  const seed = (seeded = {}) => {
    generation += 1
    current = null
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
    } catch {
      return null
    }
  }

  // Builds `{ files, entry }` (grade.js gradedModel) in a fresh state and
  // measures it, plus the fixture's `probe` when it has one.
  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS, probe } = {}) => {
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
    return probe ? { ...graded, probe: await probed(probe, model, deadline, buildMs) } : graded
  }

  return { requestTool, reset, gradeProject, files: () => ({ ...files }), lastBuild: () => current?.report ?? null }
}
