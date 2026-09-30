import { buildReport, DEFAULT_API, errorLocation, NO_ENTRY, noGeometryError, projectPath, resolveEntry, withErrorHint } from '@jscadui/agent-loop'
import { PROJECT_BASE } from '../src_frame/fileMap.js'

const MAX_MESSAGE = 4000

const textFile = (files, path) => {
  if (!path) return null
  try {
    const file = projectPath(path)
    return typeof files[file] === 'string' ? file : null
  } catch {
    return null
  }
}

const EXPORTS_MAIN = [
  /\bmodule\.exports\s*=\s*\{[^}]*\bmain\b/,
  /\bmodule\.exports\s*=\s*main\b/,
  /\b(?:module\.)?exports\.main\s*=/,
  /\bexport\s+(?:async\s+)?function\s*\*?\s*main\b/,
  /\bexport\s+(?:const|let|var)\s+main\b/,
  /\bexport\s*\{[^}]*\bmain\b[^}]*\}/,
]

const exportsMain = (text) => EXPORTS_MAIN.some((pattern) => pattern.test(text))

const RELATIVE_SPEC = /(?:\brequire\s*\(\s*|\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]*)\1/g

const joinPath = (dir, spec) => {
  const parts = []
  for (const part of [...dir.split('/'), ...spec.split('/')]) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

// The project files `entry` requires or imports, directly or through others.
const requireClosure = (files, entry) => {
  const seen = new Set([entry])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()
    const text = files[file]
    if (typeof text !== 'string') continue
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
    for (const [, , spec] of text.matchAll(RELATIVE_SPEC)) {
      const base = joinPath(dir, spec)
      const found = [base, `${base}.js`, `${base}/index.js`].find((path) => typeof files[path] === 'string')
      if (found && !seen.has(found)) {
        seen.add(found)
        queue.push(found)
      }
    }
  }
  return seen
}

/**
 * The file a project build runs. Node's rule (package.json main, index.js,
 * main.js) picks the entry, else the entry the project declares, which a
 * dropped folder names by fs-provider's own rule (index.ts, <folder>.js).
 * `open`, the file the user runs, wins when it is a model of its own: it
 * exports a main and the entry neither requires nor imports it.
 * @param {Record<string, unknown>} files
 * @param {string} [declared]
 * @param {string} [open]
 */
export const projectEntry = (files, declared, open) => {
  const entry = resolveEntry(files) ?? textFile(files, declared)
  const standalone = textFile(files, open)
  if (standalone && standalone !== entry && exportsMain(files[standalone]) && !(entry && requireClosure(files, entry).has(standalone))) return standalone
  return entry
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PROJECT_FILE = new RegExp(`${escapeRegExp(PROJECT_BASE)}([^\\s:()]+):`)

// Babel's message names the file and ends its first line with (line:column);
// the worker's re-parse keeps only the message.
const syntaxLoc = (error) => {
  if (error?.name !== 'SyntaxError' || error.loc) return error
  const first = String(error.message ?? '').split('\n')[0]
  const at = /\((\d+):(\d+)\)\s*$/.exec(first)
  const file = PROJECT_FILE.exec(first)?.[1]
  return at && file ? { ...error, file, loc: { line: Number(at[1]), column: Number(at[2]) } } : error
}

/**
 * A model error as the build report and `run` carry it: the eval backend's
 * shape, with the frame worker's `jscadMain failed: ` prefix dropped.
 * @param {{name?:string,message?:string,stack?:string}} error
 * @param {{api?:string,index?:Array<object>}} [options]
 */
export const reportError = (error, { api = DEFAULT_API, index } = {}) => {
  const raw = String(error?.message ?? error).replace(/^jscadMain failed: /, '').slice(0, MAX_MESSAGE)
  const located = errorLocation(syntaxLoc({ name: error?.name, message: raw, stack: error?.stack, loc: error?.loc, file: error?.file }), PROJECT_BASE)
  return { name: String(error?.name ?? 'Error'), message: withErrorHint(raw, { api, index }), ...located }
}

// With no index the error goes out without its hint.
const indexFor = async (loadIndex) => {
  try {
    return await loadIndex()
  } catch {
    return undefined
  }
}

/**
 * The open project's last build: the load of a project file the frame ran
 * last, whether the editor, a project switch or the chat started it. Its
 * report is measured only when asked for, so the editor's own runs pay for no
 * measure or check unless the chat reads them.
 * @param {{measure:() => Promise<object>, check:() => Promise<object>, getApi?:() => string, loadIndex?:() => Promise<Array<object>|undefined>}} deps
 */
export const createProjectBuilds = ({ measure, check, getApi = () => DEFAULT_API, loadIndex = async () => undefined }) => {
  let last = null

  const failed = async ({ entry, error }) => {
    const index = await indexFor(loadIndex)
    return buildReport({
      entry,
      error: reportError(error, { api: getApi(), index }),
      warnings: error?.output?.warnings ?? [],
      console: error?.output?.console ?? [],
    })
  }

  const built = async ({ entry, result }) => {
    const warnings = result?.warnings ?? []
    const lines = result?.console ?? []
    let measured
    let checked
    try {
      measured = await measure()
      checked = await check()
    } catch (e) {
      const error = { name: 'NoGeometryError', message: `main() returned something that is not geometry: ${e?.message ?? e}` }
      return buildReport({ entry, error, warnings, console: lines })
    }
    return buildReport({ entry, warnings, console: lines, params: result?.def ?? [], measured, checked })
  }

  const report = async () => {
    if (!last) return null
    last.report ??= last.error ? failed(last) : built(last)
    return last.report
  }

  return {
    /**
     * @param {string} url the loaded script's URL
     * @param {{result?:object, error?:unknown}} outcome
     */
    recordLoad: (url, outcome) => {
      last = typeof url === 'string' && url.startsWith(PROJECT_BASE) ? { entry: url.slice(PROJECT_BASE.length), ...outcome, report: null } : null
    },
    recordNoEntry: () => {
      last = { entry: null, error: { name: 'NoEntryError', message: NO_ENTRY }, report: null }
    },
    report,
    // Null when the last build has geometry for measure, check and export; else their answer.
    noGeometry: async () => {
      if (!last) return noGeometryError(null)
      return last.error ? noGeometryError(await report()) : null
    },
  }
}
