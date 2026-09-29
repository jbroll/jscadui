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
import { createWarningCollector, withOptionChecks, wrapFluentMethods } from '../src/optionChecks.js'
import { PROJECT_ENTRY, projectEntry } from './grade.js'

const API_INDEX = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

export const PROJECT_BASE = 'http://project.local/'
export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/'
export const GRADE_TIMEOUT_MS = 120_000
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

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

const runModel = async (files, entry) => {
  warnings.reset()
  clearAllCaches()
  moduleResolver.clearCache()
  const url = PROJECT_BASE + entry
  const source = files[entry]
  if (typeof source !== 'string') throw new Error(`file not found ${url}`)
  const transform = shouldTransform(url, source) ? transformcjs : undefined
  const capture = installConsoleCapture()
  try {
    const exports = jscadRequire({ url, script: source }, transform, createReadFile(files), PROJECT_BASE, PROJECT_BASE)
    const main = exports.main ?? (typeof exports === 'function' ? exports : undefined)
    if (typeof main !== 'function') throw new Error('model exports no main()')
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
  const project = new Map()
  // A model run that outlives a reset (gradeProject gave up on it) must not
  // overwrite the state of the run after it.
  let generation = 0

  const projectFiles = () => Object.fromEntries([...project].map(([path, file]) => [path, file.source]))

  const load = async (files, entry) => {
    const started = generation
    const loaded = await runModel(files, entry)
    if (started !== generation) return
    geometry = loaded.geometry
    params = loaded.params
    lastWarnings = loaded.warnings
    lastConsole = loaded.console
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
        await load({ ...projectFiles(), [entry]: args.source }, entry)
        return JSON.stringify(withWarnings({ ok: true, params, entities: geometry.length }))
      }
      if (name === 'measure') return geometry ? JSON.stringify({ ok: true, ...measure(geometry, args) }) : noGeometry()
      if (name === 'check') return geometry ? JSON.stringify({ ok: true, ...check(geometry, args) }) : noGeometry()
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
      return JSON.stringify(errorResult(error))
    }
  }

  // `files` seeds the project, as a fixture's files seed the app's.
  const reset = (files = {}) => {
    generation += 1
    geometry = null
    params = []
    lastWarnings = []
    lastConsole = []
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
