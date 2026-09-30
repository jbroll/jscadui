// The build report every write and edit returns, in the app and the eval:
// { ok, entry, error?: { name, message, file, line, column }, warnings,
//   console, params, geometry?: { parts, boundingBox, dimensions, volume, watertight } }.
// `measured` and `checked` are @jscadui/model-tools measure() and check()
// results for the geometry main() returned.

const round = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 + 0 : value)
const roundAll = (value) => (Array.isArray(value) ? value.map(roundAll) : round(value))

export const geometrySummary = (measured, checked) => ({
  parts: measured.entityCount ?? 1,
  boundingBox: roundAll(measured.boundingBox),
  dimensions: roundAll(measured.dimensions),
  ...(typeof measured.volume === 'number' ? { volume: round(measured.volume) } : {}),
  ...(checked ? { watertight: checked.watertight ?? null } : {}),
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
  const at = new RegExp(`${project}:(\\d+):(\\d+)`).exec(typeof error?.stack === 'string' ? error.stack : '')
  return at ? { file: at[1], line: Number(at[2]), column: Number(at[3]) } : {}
}

const reportError = ({ name, message, file, line, column }) => ({
  ...(name ? { name: String(name) } : {}),
  message: String(message ?? ''),
  ...(file ? { file } : {}),
  ...(Number.isFinite(line) ? { line } : {}),
  ...(Number.isFinite(column) ? { column } : {}),
})

/**
 * @param {{entry:string|null, error?:{name?:string,message:string,file?:string,line?:number,column?:number},
 *   warnings?:Array<object>, console?:Array<string>, params?:Array<object>, measured?:object, checked?:object}} build
 */
export const buildReport = ({ entry = null, error, warnings = [], console: lines = [], params = [], measured, checked }) => {
  if (error) return { ok: false, entry, error: reportError(error), warnings, console: lines, params: [] }
  return { ok: true, entry, warnings, console: lines, params: reportParams(params), ...(measured ? { geometry: geometrySummary(measured, checked) } : {}) }
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
