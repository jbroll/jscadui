import { readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { JscadToCommon } from '@jscadui/format-jscad'
import { check, measure } from '@jscadui/model-tools'
import { createParamsProxy, createProxyState, toParamDefinitions } from '@jscadui/params-core'
import { clearAllCaches, moduleResolver, require as jscadRequire } from '@jscadui/require/esm/index.js'
import { transformcjs } from '@jscadui/transform-babel/esm/transform-babel.js'
import { exportStlText } from '@jscadui/worker/src/exportStlText.js'
import { OPTION_TABLES } from '../api/optionTable.js'
import { DEFAULT_API } from '../src/api.js'
import { installConsoleCapture } from '../src/consoleCapture.js'
import { docsTool } from '../src/docs.js'
import { withErrorHint } from '../src/hints.js'
import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '../src/optionChecks.js'
import { withSaveState } from '../src/saveState.js'
import { GRADE_TIMEOUT_MS, PROJECT_ENTRY, projectEntry } from './grade.js'

const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

export const PROJECT_BASE = 'http://project.local/'
export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/'
export { GRADE_TIMEOUT_MS }
const nodeRequire = createRequire(import.meta.url)

const installed = (spec) => {
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
const warnings = createWarningCollector()
const wrapped = new WeakMap()
globalThis[USER_MODULE] = (spec) => {
  if (!servable(spec)) throw new Error(`failed to load module ${spec}`)
  const real = nodeRequire(spec)
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

const errorResult = (error, api) => {
  const message = withErrorHint(String(error?.message ?? error).slice(0, MAX_MESSAGE), { api, index: API_INDEX })
  return { ok: false, error: { name: String(error?.name ?? 'Error').slice(0, 200), message } }
}

const runModel = async (files, entry, api) => {
  warnings.reset()
  warnings.setApi(api)
  clearAllCaches()
  moduleResolver.clearCache()
  const url = PROJECT_BASE + entry
  const source = files[entry]
  if (typeof source !== 'string') throw new Error(`file not found ${url}`)
  const transform = shouldTransform(url, source) ? transformcjs : undefined
  const capture = installConsoleCapture()
  try {
    let exports
    try {
      exports = jscadRequire({ url, script: source }, transform, createReadFile(files), PROJECT_BASE, PROJECT_BASE)
    } catch (e) {
      // Indirect eval's SyntaxError carries no location; the frame worker hits the
      // same gap, so re-parse with Babel (same as worker.js) to get one.
      if (e.name === 'SyntaxError') transformcjs(source, url)
      throw e
    }
    const main = exports.main ?? (typeof exports === 'function' ? exports : undefined)
    if (typeof main !== 'function') return { scratch: true, warnings: warnings.list(), console: capture.list() }
    const state = createProxyState({}, new Set(), { mode: 'hierarchical' })
    const out = await main(createParamsProxy(state))
    return { geometry: [out].flat(Infinity), params: toParamDefinitions(state.discovered), warnings: warnings.list(), console: capture.list() }
  } finally {
    capture.restore()
  }
}

const noGeometry = () => JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })

// The app's worker writes STL text whatever format is asked for, and the app
// answers { format, size, data } with the bytes in base64.
const exportModel = (geometry, format) => {
  JscadToCommon.clearCache()
  const data = Buffer.from(exportStlText(JscadToCommon.ConvertMulti(geometry, [], false)).join(''))
  return { format, size: data.byteLength, data: data.toString('base64') }
}

export function createEvalBackend({ api = DEFAULT_API } = {}) {
  let geometry = null
  let params = []
  let lastWarnings = []
  let lastConsole = []
  // The entry and source of the last geometry-producing eval, to tell the model
  // whether writeModel has since caught up with what it is looking at.
  let lastEntry = null
  let lastSource = null
  const project = new Map()
  // A model run that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0

  const projectFiles = () => Object.fromEntries([...project].map(([path, file]) => [path, file.source]))

  const unsaved = () => lastEntry !== null && project.get(lastEntry)?.source !== lastSource

  const load = async (files, entry, { allowScratch = false } = {}) => {
    const started = generation
    const loaded = await runModel(files, entry, api)
    if (started !== generation) return null
    lastWarnings = loaded.warnings
    lastConsole = loaded.console
    if (loaded.scratch) {
      if (!allowScratch) throw new Error('model exports no main()')
      return { scratch: true }
    }
    geometry = loaded.geometry
    params = loaded.params
    lastEntry = entry
    lastSource = files[entry]
    return { scratch: false }
  }

  const withWarnings = (result) => {
    let out = result
    if (lastWarnings.length) out = { ...out, warnings: lastWarnings }
    if (lastConsole.length) out = { ...out, console: lastConsole }
    return out
  }

  const requestTool = async (name, input) => {
    try {
      const args = input ?? {}
      if (name === 'eval') {
        const entry = args.entry ?? PROJECT_ENTRY
        const result = await load({ ...projectFiles(), [entry]: args.source }, entry, { allowScratch: true })
        if (result?.scratch) {
          const scratch = { ok: true, scratch: true, message: 'no main(): nothing rendered, current model unchanged' }
          return JSON.stringify(withSaveState(withWarnings(scratch), unsaved()))
        }
        return JSON.stringify(withSaveState(withWarnings({ ok: true, params, entities: geometry.length }), unsaved()))
      }
      if (name === 'measure') return geometry ? JSON.stringify(withSaveState({ ok: true, ...measure(geometry, args) }, unsaved())) : noGeometry()
      if (name === 'check') return geometry ? JSON.stringify(withSaveState({ ok: true, ...check(geometry, args) }, unsaved())) : noGeometry()
      if (name === 'params') return JSON.stringify({ ok: true, params })
      if (name === 'docs') return docsTool(API_INDEX, args.query, { api })
      if (name === 'writeModel') {
        const entry = args.entry ?? PROJECT_ENTRY
        project.set(entry, { source: args.source, message: args.message ?? '' })
        const files = projectFiles()
        await load(files, projectEntry(files, entry))
        return JSON.stringify(withWarnings({ ok: true, entry }))
      }
      if (name === 'export') return geometry ? JSON.stringify(exportModel(geometry, args.format)) : noGeometry()
      if (name === 'view') {
        return JSON.stringify({ ok: false, error: { name: 'UnavailableError', message: `${name} is unavailable in the eval harness` } })
      }
      return JSON.stringify(errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` }))
    } catch (error) {
      return JSON.stringify(errorResult(error, api))
    }
  }

  // `files` seeds the project, as a fixture's files seed the app's.
  const reset = (files = {}) => {
    generation += 1
    geometry = null
    params = []
    lastWarnings = []
    lastConsole = []
    lastEntry = null
    lastSource = null
    project.clear()
    for (const [path, source] of Object.entries(files)) project.set(path, { source, message: '' })
  }

  // Measures `{ files, entry }` (grade.js gradedModel) in a fresh state.
  const gradeProject = async (model, { timeoutMs = GRADE_TIMEOUT_MS } = {}) => {
    const none = { measure: null, solid: null, params: [] }
    reset(model?.files)
    if (!model) return none
    let timer
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs, none)
    })
    const evaluated = await Promise.race([requestTool('eval', { source: model.files[model.entry], entry: model.entry }), timedOut])
    clearTimeout(timer)
    if (evaluated === none) {
      reset()
      return none
    }
    const measured = JSON.parse(await requestTool('measure', {}))
    const checked = JSON.parse(await requestTool('check', {}))
    return { measure: measured.ok ? measured : null, solid: checked.ok ? checked : null, params }
  }

  return { requestTool, reset, gradeProject, project, params: () => params }
}
