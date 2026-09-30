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
import { docsTool } from '../src/docs.js'
import { withErrorHint } from '../src/hints.js'
import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '../src/optionChecks.js'
import { asGeometry, buildReport, errorLocation, noEntryReport, noGeometryError, noMainError, notGeometryError, summarizeRun, withoutLoaderNote, writeReport } from '../src/buildReport.js'
import { exportConfig, exportedSize } from '../src/exportFormat.js'
import { applyEdit, applyWrite, listFiles, readFile, resolveEntry } from '../src/project.js'
import { withUnits } from '../src/units.js'
import { GRADE_TIMEOUT_MS } from './grade.js'
import { runProbe } from './probe.js'

const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

export const PROJECT_BASE = 'http://project.local/'
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

// Copied from packages/worker/worker.js (a test keeps them equal): the frame
// transforms the entry only when it has an import or an export-from line.
export const IMPORT_REG = /import(?:(?:(?:[ \n\t]+([^ *\n\t{},]+)[ \n\t]*(?:,|[ \n\t]+))?([ \n\t]*\{(?:[ \n\t]*[^ \n\t"'{}]+[ \n\t]*,?)+\})?[ \n\t]*)|[ \n\t]*\*[ \n\t]*as[ \n\t]+([^ \n\t{}]+)[ \n\t]+)from[ \n\t]*(?:['"])([^'"\n]+)(['"])/
export const EXPORT_REG = /export.*from/

export const shouldTransform = (url, script) =>
  url.endsWith('.ts') || (script.includes('import') && (IMPORT_REG.test(script) || EXPORT_REG.test(script)))

const packageSpec = (url) => url.slice(CDN_BASE.length).replace(/^((?:@[^/]+\/)?[^/@]+)@[^/]+/, '$1')

// The frame fetches CDN packages; here they come from node_modules, and a
// missing one throws the text the frame's fetch gives a 404. Node resolves its
// built-ins too, which the browser has none of.
export const createReadFile = (files) => (path) => {
  if (path.startsWith(PROJECT_BASE)) {
    const projectPath = path.slice(PROJECT_BASE.length)
    if (Object.hasOwn(files, projectPath)) return files[projectPath]
  } else if (path.startsWith(CDN_BASE)) {
    const spec = packageSpec(path)
    if (servable(spec)) {
      return `module.exports = globalThis[Symbol.for('jscadui.eval.userModule')](${JSON.stringify(spec)})`
    }
  }
  throw new Error(`file not found ${path}`)
}

const MAX_MESSAGE = 4000

// The file a scratch `run` snippet runs as, beside the project's files.
export const RUN_FILE = '__run__.js'

const located = (error, api) => {
  const message = withErrorHint(withoutLoaderNote(String(error?.message ?? error)).slice(0, MAX_MESSAGE), { api, index: API_INDEX })
  return { name: String(error?.name ?? 'Error').slice(0, 200), message, ...errorLocation(error, PROJECT_BASE) }
}

const errorResult = (error, api) => ({ ok: false, error: located(error, api) })

const toolError = (name, message) => JSON.stringify({ ok: false, error: { name, message } })

// Indirect eval's SyntaxError carries no location; the frame worker hits the
// same gap, so re-parse with Babel (as worker.js does) to find the file and
// line. Its wrapper drops Babel's `loc`, which its message still ends with.
const locateSyntaxError = (files, entry, error) => {
  const paths = [entry, ...Object.keys(files).filter((p) => p !== entry && p.endsWith('.js')).sort()]
  for (const path of paths) {
    if (typeof files[path] !== 'string') continue
    try {
      transformcjs(files[path], PROJECT_BASE + path)
    } catch (parseError) {
      const at = /\((\d+):(\d+)\)/.exec(String(parseError?.message).split('\n')[0])
      if (at) return Object.assign(parseError, { file: path, loc: { line: Number(at[1]), column: Number(at[2]) } })
    }
  }
  // The stack would name the require call site, not the error.
  return { name: error.name, message: error.message }
}

// Runs `entry` over `files` and, when it exports one, its main(). Never throws.
// `wrapRequire` wraps the require the entry's own code calls.
const runModel = async (files, entry, api, { wrapRequire } = {}) => {
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
      exports = jscadRequire({ url, script: source, wrapRequire }, transform, createReadFile(files), PROJECT_BASE, PROJECT_BASE)
    } catch (e) {
      throw e?.name === 'SyntaxError' ? locateSyntaxError(files, entry, e) : e
    }
    const main = exports?.main ?? (typeof exports === 'function' ? exports : undefined)
    if (typeof main !== 'function') return settle({ exports, hasMain: false })
    const state = createProxyState({}, new Set(), { mode: 'hierarchical' })
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
    const { warnings: warned, console: lines } = loaded
    let error = loaded.error ? located(loaded.error, api) : null
    if (!error && !loaded.hasMain) error = noMainError(entry)
    let geometry
    let measured
    let checked
    if (!error) {
      geometry = [loaded.value].flat(Infinity)
      try {
        measured = measure(asGeometry(geometry))
        checked = check(asGeometry(geometry))
      } catch {
        error = notGeometryError()
      }
    }
    if (error) {
      current = { report: buildReport({ entry, error, warnings: warned, console: lines }) }
      return current.report
    }
    current = { report: buildReport({ entry, warnings: warned, console: lines, params: loaded.params, measured, checked }), geometry, params: loaded.params }
    return current.report
  }

  const saved = async (next) => {
    files = next.files
    const report = await build()
    return report ? JSON.stringify(writeReport(next.path, report)) : toolError('ResetError', 'the run was reset before the build finished')
  }

  // A scratch snippet beside the project: the project, its build and its geometry stay as they were.
  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const loaded = await runModel({ ...files, [RUN_FILE]: source }, RUN_FILE, api, { wrapRequire: withProjectMains })
    const { warnings: warned, console: lines } = loaded
    if (loaded.error) return { ok: false, error: located(loaded.error, api), warnings: warned, console: lines }
    const summary = summarizeRun({ hasMain: loaded.hasMain, value: loaded.hasMain ? loaded.value : loaded.exports }, measure)
    return { ok: true, warnings: warned, console: lines, ...summary }
  }

  const noGeometry = () => JSON.stringify(noGeometryError(current?.report ?? null))

  const requestTool = async (name, input) => {
    try {
      const args = input ?? {}
      if (name === 'list') return JSON.stringify(listFiles(files))
      if (name === 'read') return readFile(files, args)
      if (name === 'write') return await saved(applyWrite(files, args))
      if (name === 'edit') return await saved(applyEdit(files, args))
      if (name === 'run') return JSON.stringify(await run(args.source))
      const geometry = current?.geometry
      if (name === 'measure') return geometry ? JSON.stringify(withUnits({ ok: true, ...measure(asGeometry(geometry), args) })) : noGeometry()
      if (name === 'check') return geometry ? JSON.stringify(withUnits({ ok: true, ...check(asGeometry(geometry), args) })) : noGeometry()
      if (name === 'export') return geometry ? JSON.stringify(exportModel(geometry, args.format)) : noGeometry()
      if (name === 'docs') return docsTool(API_INDEX, args.query, { api })
      if (name === 'view') return toolError('UnavailableError', `${name} is unavailable in the eval harness`)
      return toolError('UnknownToolError', `unknown tool ${name}`)
    } catch (error) {
      return JSON.stringify(errorResult(error, api))
    }
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

  const probed = (spec) => {
    if (!current?.geometry) return null
    try {
      return runProbe(current.geometry, spec)
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
    let timer
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs, none)
    })
    const report = await Promise.race([build(model.entry), timedOut])
    clearTimeout(timer)
    if (report === none) {
      seed()
      return none
    }
    if (!report?.ok) return none
    const measured = JSON.parse(await requestTool('measure', {}))
    const checked = JSON.parse(await requestTool('check', {}))
    const graded = { measure: measured.ok ? measured : null, solid: checked.ok ? checked : null, params: current.params }
    return probe ? { ...graded, probe: probed(probe) } : graded
  }

  return { requestTool, reset, gradeProject, files: () => ({ ...files }), lastBuild: () => current?.report ?? null }
}
