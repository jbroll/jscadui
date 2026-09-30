import { assembleReport, DEFAULT_API, noEntryReport, noGeometryError, noMainError, notGeometryError, PROJECT_BASE, projectPath, reportError, resolveEntry } from '@jscadui/agent-loop'

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
 * The file a project build runs: agent-loop's resolveEntry, else the entry the
 * project declares, such as a dropped folder's `<folder>/<entry>`.
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

// With no index the error goes out without its hint.
export const indexFor = async (loadIndex) => {
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

  // The worker's own wording of these two, as the eval words them.
  const buildError = async (entry, error) => {
    if (error?.name === 'NoMainError') return noMainError(entry)
    if (/invalid jscad geometry, not an object/.test(String(error?.message))) return notGeometryError()
    return reportError(error, { api: getApi(), index: await indexFor(loadIndex) })
  }

  const assemble = async ({ entry, error, result }) => {
    if (error) return assembleReport({ entry, error: await buildError(entry, error), warnings: error.output?.warnings, console: error.output?.console, measure, check })
    return assembleReport({ entry, warnings: result?.warnings, console: result?.console, params: result?.def, measure, check })
  }

  const report = async () => {
    if (!last) return null
    last.report ??= last.entry === null ? Promise.resolve(noEntryReport()) : assemble(last)
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
      last = { entry: null, report: null }
    },
    report,
    // Null when the last build has geometry for measure, check and export; else their answer.
    noGeometry: async () => {
      const built = await report()
      return built?.ok && built.entry !== null ? null : noGeometryError(built)
    },
  }
}
