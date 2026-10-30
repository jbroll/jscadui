// The build report every write and edit returns, in the app and the eval:
// { ok, entry, error?: { name, message, file, line, column }, warnings,
//   console, params, geometry?: { parts, boundingBox, dimensions, volume,
//   watertight, manifold, selfIntersecting } }, which writeReport heads with
// the file saved. A part interference or reference tag failure keeps geometry
// and adds `interference` and `references` from check().
// `measured` and `checked` are @jscadui/model-tools measure() and check()
// results for the geometry main() returned.

import { isCodePath, requireClosure } from './project.js'

const round = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 + 0 : value)
const roundAll = (value) => (Array.isArray(value) ? value.map(roundAll) : round(value))

export const geometrySummary = (measured, checked) => ({
  parts: measured.entityCount ?? 1,
  boundingBox: roundAll(measured.boundingBox),
  dimensions: roundAll(measured.dimensions),
  ...(typeof measured.volume === 'number' ? { volume: round(measured.volume) } : {}),
  ...(checked ? { watertight: checked.watertight ?? null, manifold: checked.manifold ?? null, selfIntersecting: checked.selfIntersecting ?? null } : {}),
})

const PARAM_FIELDS = ['min', 'max', 'step', 'values']

// params-core's definitions (`initial`, group rows) as the model wrote them (`default`).
export const reportParams = (definitions = []) =>
  definitions
    .filter((d) => d && d.type !== 'group')
    .map((d) => {
      const out = { name: d.name, type: d.type, default: d.initial ?? d.default }
      for (const key of PARAM_FIELDS) if (d[key] !== undefined) out[key] = d[key]
      return out
    })

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A Babel SyntaxError carries `loc` (0-based column) and names its file at the
// start of its message; a runtime error names project files in its stack as
// `<base><path>:<line>:<column>`, in Chrome's, Firefox's and Node's formats alike.
export const errorLocation = (error, base) => {
  const project = `${escapeRegExp(base)}([^\\s:()]+)`
  if (error?.loc && typeof error.loc.line === 'number') {
    const file = error.file ?? new RegExp(`^${project}:`).exec(String(error.message ?? ''))?.[1]
    if (file) return { file, line: error.loc.line, column: error.loc.column + 1 }
  }
  const frames = [...(typeof error?.stack === 'string' ? error.stack : '').matchAll(new RegExp(`${project}:(\\d+):(\\d+)`, 'g'))]
  if (frames.length === 0) return {}
  const [[, file, line, column], ...callers] = frames
  // A throw in a shared helper is usually the caller's bad argument, so name the callers too.
  const calledFrom = [...new Set(callers.map(([, f, l]) => `${f}:${l}`))].filter((at) => at !== `${file}:${line}`).slice(0, MAX_CALLERS)
  return { file, line: Number(line), column: Number(column), ...(calledFrom.length > 0 ? { calledFrom } : {}) }
}

const MAX_CALLERS = 4

// The loader appends this to an error thrown while a module loads; the
// location already names the file, and a snippet's own name misleads.
export const withoutLoaderNote = (message) => String(message).replace(/ \/ failed loading module \S+/g, '')

const reportError = ({ name, message, file, line, column, calledFrom }) => ({
  ...(name ? { name: String(name) } : {}),
  message: String(message ?? ''),
  ...(file ? { file } : {}),
  ...(Number.isFinite(line) ? { line } : {}),
  ...(Number.isFinite(column) ? { column } : {}),
  ...(Array.isArray(calledFrom) && calledFrom.length > 0 ? { calledFrom } : {}),
})

/**
 * @param {{entry:string|null, error?:{name?:string,message:string,file?:string,line?:number,column?:number,calledFrom?:string[]},
 *   warnings?:Array<object>, console?:Array<string>, params?:Array<object>, measured?:object, checked?:object}} build
 */
export const buildReport = ({ entry = null, error, warnings = [], console: lines = [], params = [], measured, checked }) => {
  if (error) return { ok: false, entry, error: reportError(error), warnings, console: lines, params: [] }
  return { ok: true, entry, warnings, console: lines, params: reportParams(params), ...(measured ? { geometry: geometrySummary(measured, checked) } : {}) }
}

/**
 * The report of a build that ran, in the app and the eval, which each run the
 * model their own way: `error` failed it; else `measure` and `check` (sync or
 * async) read what main() returned, and a throw from either means it was not geometry.
 * @param {{entry:string, error?:object, warnings?:Array<object>, console?:Array<string>, params?:Array<object>,
 *   measure:() => object|Promise<object>, check:() => object|Promise<object>}} build
 */
export const assembleReport = async ({ entry, error, warnings = [], console: lines = [], params = [], measure, check }) => {
  if (error) return buildReport({ entry, error, warnings, console: lines })
  let measured
  let checked
  try {
    measured = await measure()
    checked = await check()
  } catch {
    return buildReport({ entry, error: notGeometryError(), warnings, console: lines })
  }
  const unchecked = checked?.interferenceUnchecked > 0 ? [{ severity: 'warning', source: 'check', message: `${checked.interferenceUnchecked} overlapping part pairs were not checked for shared volume` }] : []
  const all = [...warnings, ...unchecked]
  const references = checked?.references?.length > 0 ? checked.references : undefined
  const failure = partFailure(checked)
  if (!failure) return { ...buildReport({ entry, warnings: all, console: lines, params, measured, checked }), ...(references ? { references } : {}) }
  return {
    ok: false,
    entry,
    error: reportError(failure),
    warnings: all,
    console: lines,
    params: reportParams(params),
    geometry: geometrySummary(measured, checked),
    ...(checked.interference ? { interference: checked.interference } : {}),
    ...(references ? { references } : {}),
  }
}

const mm = (n) => Math.round(n * 10) / 10

// Bad tags win: a misread tag makes the overlap list untrustworthy.
const partFailure = (checked) => {
  if (checked?.tagErrors?.length > 0) return { name: 'PartTagError', message: checked.tagErrors.join('; ') }
  const { pairs = [], total = 0 } = checked?.interference ?? {}
  if (total === 0 || pairs.length === 0) return undefined
  const [first] = pairs
  const more = total - 1
  const rest = more > 0 ? `; ${more} more ${more === 1 ? 'pair overlaps' : 'pairs overlap'}` : ''
  const message = `parts ${first.a} and ${first.b} share ${mm(first.volume)} mm³ (a ${first.size.map(mm).join(' x ')} mm region)${rest}. Each item main() returns is a separate part in one color; parts may touch but not share volume. Assembly parts that share volume collide: move or resize one. A detail in another color is its own part: subtract it from the part around it so the two touch. Pieces of one color that print as one part are one solid: union them, then color the result. Purchased hardware is a reference part and is checked too (docs reference).`
  return { name: 'InterferenceError', message }
}

export const NO_ENTRY_NOTE ='no entry yet (main.js, index.js or package.json main)'

// A project of helper modules only builds nothing and fails nothing.
export const noEntryReport = () => ({ ok: true, entry: null, note: NO_ENTRY_NOTE, warnings: [], console: [], params: [] })

// What a write or edit answers: its build report, headed by the file saved,
// so a failed build never reads as a lost write. With the project `files`, a
// saved model file the entry never reaches says the build ignored it.
export const writeReport = (path, report, files) => {
  let note
  if (report.ok && report.entry === null) note = `saved; ${report.note}`
  else if (!report.ok && typeof report.entry === 'string') note = `${path} is saved; the build of ${report.entry} failed`
  else if (report.ok && files && isCodePath(path) && !requireClosure(files, report.entry).has(path))
    note = `${path} is not required from ${report.entry}; the build and the viewer still show the previous model`
  return { saved: path, ...report, ...(note ? { note } : {}) }
}

const describeFunction = (fn) => `[Function ${fn.name || 'anonymous'}]`

// What a scratch `run` returned that is not geometry, as capped JSON text.
export const previewValue = (value, max = 1000) => {
  let text
  if (value === undefined) text = 'undefined'
  else if (typeof value === 'function') text = describeFunction(value)
  else {
    const seen = new WeakSet()
    const replacer = (_key, v) => {
      if (typeof v === 'function') return describeFunction(v)
      if (typeof v === 'bigint') return String(v)
      if (v !== null && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return v
    }
    try {
      text = JSON.stringify(value, replacer) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text
}

// The loader gives every module's exports a `default` pointing back at them.
const withoutSelfDefault = (exports) => {
  if (exports === null || typeof exports !== 'object' || exports.default !== exports) return exports
  const { default: _self, ...rest } = exports
  return rest
}

const isGeometry = (item) => item !== null && typeof item === 'object' && ('polygons' in item || 'sides' in item)

// What a scratch `run` answers about its value: `value` is what main()
// returned, or the module's exports when it has no main. `measure` and
// `check` are @jscadui/model-tools', which the eval and the frame each load their own way.
export const summarizeRun = ({ hasMain, value }, measure, check) => {
  const shown = hasMain ? value : withoutSelfDefault(value)
  const items = [shown].flat(Infinity)
  if (hasMain && items.length > 0 && items.every(isGeometry)) return { geometry: geometrySummary(measure(items), check?.(items, { interference: false })) }
  const empty = !hasMain && shown !== null && typeof shown === 'object' && Object.keys(shown).length === 0
  return empty ? {} : { returned: previewValue(shown) }
}

// A scratch `run` stops after this long, in the app's frame and the eval's executor alike.
export const RUN_TOOL_TIMEOUT_MS = 30_000

export const runTimeoutError = (ms = RUN_TOOL_TIMEOUT_MS) => ({
  ok: false,
  error: { name: 'TimeoutError', message: `run stopped after ${ms / 1000} s; try a smaller case` },
})

export const OUT_OF_MEMORY = 'out of memory'
const MEMORY_ERROR = /JavaScript heap out of memory|Reached heap limit|Last few GCs|Array buffer allocation failed|could not allocate memory/i

// An allocation failure or a V8 heap log reads as what it is.
export const memoryMessage = (message) => (MEMORY_ERROR.test(String(message)) ? `${OUT_OF_MEMORY}; try a smaller case` : message)

// The build errors the app and the eval word alike, with no API hint.
export const noMainError = (entry) => ({ name: 'NoMainError', message: `${entry} exports no main()` })

export const notGeometryError = () => ({ name: 'NoGeometryError', message: 'main() returned something that is not geometry; return a shape or an array of shapes' })

// The frame measures, checks and exports one part as itself and more as an array.
export const asGeometry = (items) => (items.length === 1 ? items[0] : items)

// Why measure, check and export have nothing to work on: no build yet, or `report` failed.
export const noGeometryError = (report) => ({
  ok: false,
  error: {
    name: 'NoGeometryError',
    message: !report
      ? 'no geometry: write the model first'
      : report.ok && report.entry === null
        ? `no geometry: ${report.note}`
        : `no geometry: the last build failed (${String(report.error?.message ?? '').split('\n')[0]}); fix it first`,
  },
})
