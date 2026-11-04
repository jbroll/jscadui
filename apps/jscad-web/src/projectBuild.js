import { assembleReport, DEFAULT_API, noEntryReport, noGeometryError, noMainError, notGeometryError, PROJECT_BASE, projectPath, reportError, requireClosure, resolveEntry } from '@jscadui/agent-loop'

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

// Keys only: `{ lid: makeLid }` exports `lid`, not a maker.
const EXPORTS_MAKER = [
  /\bmodule\.exports\s*=\s*\{(?:[^}]*,)?\s*make[A-Z]\w*\s*[,:}(]/,
  /\b(?:module\.)?exports\.make[A-Z]\w*\s*=/,
  /\bexport\s+(?:async\s+)?function\s*\*?\s*make[A-Z]/,
  /\bexport\s+(?:const|let|var)\s+make[A-Z]/,
  /\bexport\s*\{[^}]*\bmake[A-Z][^}]*\}/,
]

export const exportsMaker = (text) => EXPORTS_MAKER.some((pattern) => pattern.test(text))

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

/** The synthesized entry a part file's makers render through, named beside the part. */
export const PART_VIEW = '.part-view.js'

const GAP_MM = 5

/**
 * An entry for a part file: every `make[A-Z]*` function it exports, called
 * with the run's params, flattened and laid out along +x by bounding box.
 * @param {string} path the part file, a bare project path
 */
export const partViewScript = (path) => `const part = require(${JSON.stringify(`./${path.slice(path.lastIndexOf('/') + 1)}`)})
const { measurements, transforms } = require('@jscad/modeling')
const main = async (params) => {
  const shapes = []
  for (const name of Object.keys(part)) {
    if (/^make[A-Z]/.test(name) && typeof part[name] === 'function') shapes.push(...[await part[name](params)].flat(Infinity))
  }
  const placed = []
  let x = 0
  for (const shape of shapes) {
    // The frame's tree measures a shape with an async leaf as a Promise.
    const [[minX], [maxX]] = await measurements.measureBoundingBox(shape)
    placed.push(transforms.translateX(x - minX, shape))
    x += maxX - minX + ${GAP_MM}
  }
  return placed
}
module.exports = { main }
`

/**
 * What the viewer shows for the selected file `view`: the entry the chat
 * builds (`entry`), a file that exports a main (`file`), a part file's makers
 * through a synthesized entry (`makers`, with its `url` and `script`), or
 * nothing to show (`none`).
 * @param {Record<string, unknown>} files
 * @param {string} [declared]
 * @param {string} [view]
 */
export const viewPlan = (files, declared, view) => {
  const entry = projectEntry(files, declared)
  const path = textFile(files, view)
  if (!path || path === entry) return { kind: 'entry', path: entry }
  const text = /** @type {string} */ (files[path])
  if (exportsMain(text)) return { kind: 'file', path }
  if (exportsMaker(text)) return { kind: 'makers', path, url: path.slice(0, path.lastIndexOf('/') + 1) + PART_VIEW, script: partViewScript(path) }
  return { kind: 'none', path }
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
 * @param {{measure:() => Promise<object>, check:() => Promise<object>, getApi?:() => string, loadIndex?:() => Promise<Array<object>|undefined>, getFiles?:() => Promise<Record<string, unknown>|undefined>}} deps
 */
export const createProjectBuilds = ({ measure, check, getApi = () => DEFAULT_API, loadIndex = async () => undefined, getFiles = async () => undefined }) => {
  let last = null

  // The worker's own wording of these two, as the eval words them.
  const buildError = async (entry, error) => {
    if (error?.name === 'NoMainError') return noMainError(entry)
    if (/invalid jscad geometry, not an object/.test(String(error?.message))) return notGeometryError()
    return reportError(error, { api: getApi(), index: await indexFor(loadIndex), files: await getFiles() })
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
    /** A build that never ran, such as a write the syntax check refused: its failure report is the last build. */
    recordReport: (built) => {
      last = { entry: built.entry, report: Promise.resolve(built) }
    },
    recordNoEntry: () => {
      last = { entry: null, report: null }
    },
    report,
    // Null when the last build has geometry for measure, check and export; else their answer.
    noGeometry: async () => {
      const built = await report()
      return built?.geometry || (built?.ok && built.entry !== null) ? null : noGeometryError(built)
    },
  }
}
