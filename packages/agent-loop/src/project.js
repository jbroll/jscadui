// The project file operations behind the list, read, write, edit and delete
// tools, shared by the eval backend and the app so both answer the same way. A
// project is a map of project-relative paths to file text.
export const PACKAGE_JSON = 'package.json'
export const READ_LIMIT = 2000
export const NO_ENTRY = 'no entry file: write main.js, or index.js, or name the entry in package.json "main"'

const named = (name, message) => Object.assign(new Error(message), { name })

// `./a/b.js`, `/a/b.js` and `a//b.js` are all `a/b.js`; nothing leaves the project.
export const projectPath = (path) => {
  if (typeof path !== 'string' || path.trim() === '') throw named('PathError', 'path must be a project file path such as main.js')
  // A model that mangles its call can put the whole file in path.
  if (/[\n\r"]/.test(path)) {
    throw named('PathError', `path ${path.split(/[\n\r]/)[0]} is not a file path: it holds a line break or a quote; pass just the file name, such as main.js, and the text as content`)
  }
  const parts = path.trim().split('/').filter((part) => part !== '' && part !== '.')
  if (parts.includes('..')) throw named('PathError', `path ${path} leaves the project; use a path inside it such as main.js`)
  if (parts.length === 0) throw named('PathError', `path ${path} names no file`)
  return parts.join('/')
}

const textOf = (files, path) => {
  const text = files[path]
  if (typeof text === 'string') return text
  if (text !== undefined) throw named('BinaryFileError', `${path} is a binary file; read and edit work on text files`)
  throw named('FileNotFoundError', `no file ${path} in the project; list shows the files`)
}

const mainCandidates = (main) => [main, `${main}.js`, `${main}/index.js`]

const packageMain = (packageJson) => {
  if (typeof packageJson !== 'string') return undefined
  try {
    return projectPath(JSON.parse(packageJson)?.main)
  } catch {
    return undefined
  }
}

const depth = (path) => path.split('/').length
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The entry among `paths`, first match wins: package.json `main` (also as
 * `<main>.js` or `<main>/index.js`; kept when it names no file, so the build
 * says it is missing), index.js, index.ts, main.js, `<folder>.js`,
 * `<folder>.ts`, then with `anyJs` the shallowest .js by name. Else null.
 * @param {Array<string>} paths
 * @param {{folder?: string, packageJson?: string, anyJs?: boolean}} [options]
 * @returns {string | null}
 */
export const pickEntry = (paths, { folder, packageJson, anyJs = false } = {}) => {
  const has = new Set(paths)
  const main = packageMain(packageJson)
  if (main) return mainCandidates(main).find((path) => has.has(path)) ?? main
  const named = ['index.js', 'index.ts', 'main.js', ...(folder ? [`${folder}.js`, `${folder}.ts`] : [])].find((path) => has.has(path))
  if (named) return named
  if (!anyJs) return null
  return paths.filter((path) => path.endsWith('.js')).sort((a, b) => depth(a) - depth(b) || byName(a, b))[0] ?? null
}

// A project's entry: pickEntry over its text files, without guessing at a .js.
export const resolveEntry = (files) => {
  const sources = Object.keys(files).filter((path) => typeof files[path] === 'string' && !isTestOrNotesPath(path))
  const entry = pickEntry(sources, { packageJson: files[PACKAGE_JSON] })
  // package.json main can still name a test/notes file (pickEntry keeps a
  // main that names a file): fall back to the default entry rules, and null
  // when no valid entry remains, so test/notes can never build as geometry.
  if (entry === null || !isTestOrNotesPath(entry)) return entry
  return pickEntry(sources, {})
}

const byteSize = (content) => (typeof content === 'string' ? new TextEncoder().encode(content).length : (content?.byteLength ?? 0))

export const listFiles = (files) => ({
  ok: true,
  files: Object.keys(files)
    .sort()
    .map((path) => ({ path, size: byteSize(files[path]) })),
})

const splitLines = (text) => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.floor(Number(value)) : fallback)

// Numbered like `cat -n`; `offset` is the first line shown (1-based), `limit` how many.
export const readFile = (files, { path, offset, limit } = {}) => {
  const file = projectPath(path)
  const text = textOf(files, file)
  if (text === '') return `(${file} is empty)`
  const lines = splitLines(text)
  const start = positive(offset, 1)
  if (start > lines.length) throw named('RangeError', `offset ${start} is past the end of ${file}, which has ${lines.length} lines`)
  const shown = lines.slice(start - 1, start - 1 + positive(limit, READ_LIMIT))
  const end = start + shown.length - 1
  const body = shown.map((line, i) => `${String(start + i).padStart(6)}\t${line}`).join('\n')
  return end < lines.length ? `${body}\n… (${file}: lines ${start}-${end} of ${lines.length}; read on with offset ${end + 1})` : body
}

export const SEARCH_LIMIT = 60

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const searchFiles = (files, { pattern, include, literal = false } = {}) => {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw named('SearchError', 'pattern must be a non-empty string such as cube')
  }
  let re
  try {
    re = new RegExp(literal === true ? escapeRegex(pattern) : pattern, 'g')
  } catch {
    throw named('SearchError', `pattern ${pattern} is not a valid regex; pass literal: true to search for it as text`)
  }
  const names = (Array.isArray(include) && include.length > 0 ? include : Object.keys(files)).map((p) => projectPath(p)).sort()
  const hits = []
  for (const name of names) {
    const text = files[name]
    if (typeof text !== 'string') continue
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      re.lastIndex = 0
      if (re.test(line)) hits.push(`${name}:${i + 1}: ${line.slice(0, 300)}`)
    })
  }
  if (hits.length === 0) return `(no hits for ${pattern})`
  const shown = hits.slice(0, SEARCH_LIMIT)
  return hits.length > shown.length
    ? `${shown.join('\n')}\n… (${hits.length - shown.length} more hits; narrow the pattern)`
    : shown.join('\n')
}

export const applyWrite = (files, { path, content } = {}) => {
  const file = projectPath(path)
  if (typeof content !== 'string') throw named('TypeError', 'content must be the full file text, a string')
  return { files: { ...files, [file]: content }, path: file }
}

const occurrences = (text, part) => text.split(part).length - 1

export const applyEdit = (files, { path, oldString, newString, replaceAll = false } = {}) => {
  const file = projectPath(path)
  const text = textOf(files, file)
  if (typeof oldString !== 'string' || typeof newString !== 'string') throw named('EditError', 'oldString and newString must both be strings')
  if (oldString === '') throw named('EditError', 'oldString is empty; use write to replace the whole file')
  if (oldString === newString) throw named('EditError', 'oldString and newString are the same; nothing to change')
  const count = occurrences(text, oldString)
  if (count === 0) throw named('EditError', `oldString is not in ${file}; copy it from the file exactly, including whitespace and indentation`)
  if (count > 1 && replaceAll !== true) {
    throw named('EditError', `oldString occurs ${count} times in ${file}; include more surrounding lines to make it unique, or pass replaceAll: true`)
  }
  const at = text.indexOf(oldString)
  const edited = replaceAll === true ? text.split(oldString).join(newString) : text.slice(0, at) + newString + text.slice(at + oldString.length)
  return { files: { ...files, [file]: edited }, path: file }
}

// A delete removes the file; one that is not there is a success no-op, so a
// stale path from the project note never fails the model.
export const applyDelete = (files, { path } = {}) => {
  const file = projectPath(path)
  if (!Object.hasOwn(files, file)) return { files: { ...files }, path: file, deleted: false }
  const { [file]: _gone, ...rest } = files
  return { files: rest, path: file, deleted: true }
}

// Project keys are normalized on write, but tool input may carry `./` or a
// leading slash: strip those (and whitespace) before any prefix test, so
// `./test/a.js` cannot bypass an exclusion.
const cleanPath = (path) => (typeof path === 'string' ? path.trim().replace(/^\.\//, '').replace(/^\/+/, '') : '')

/**
 * Whether `path` lives under the project's `test/` or `notes/` directories.
 * The one normalized predicate behind the code-write gate and the
 * build/entry exclusions, so unnormalized keys cannot bypass them.
 * @param {string} path the project-relative path
 * @returns {boolean} true for `test/**` and `notes/**`
 */
export const isTestOrNotesPath = (path) => {
  const clean = cleanPath(path)
  return clean.startsWith('test/') || clean.startsWith('notes/')
}

/**
 * Whether a project path is a test file: `.js` files under the `test/`
 * directory only. Notes, skills and model sources never match, so they
 * never load into a run. Shared by the browser test runner and the eval
 * backend so the selection cannot drift.
 * @param {string} path the project-relative path
 * @returns {boolean} true for `test/` javascript files
 */
export const isTestFile = (path) => {
  if (typeof path !== 'string') return false
  const clean = cleanPath(path)
  return clean.startsWith('test/') && clean.endsWith('.js')
}

/**
 * Whether a write to `path` carries code: a `.js` file outside `test/` and
 * `notes/`. Only code writes run the full test suite after the build; docs,
 * notes and the test files themselves skip tests.
 * @param {string} path the project-relative path
 * @returns {boolean} true when a write to the path runs the test suite
 */
export const isCodePath = (path) => {
  if (typeof path !== 'string') return false
  return cleanPath(path).endsWith('.js') && !isTestOrNotesPath(path)
}

/**
 * The files a geometry build sees: the project without `test/` and `notes/`.
 * The app's frame runs the entry only, but the file map still carries every
 * file for lazy requires — and the eval backend hands its map to the model
 * runner directly, where `test/index.js` would otherwise resolve as the
 * entry. Stripping both keeps test and note writes from ever executing as
 * geometry. A test-only project builds to the no-entry report, gracefully.
 * @param {Record<string, string|ArrayBuffer>} [files] the project files
 * @returns {Record<string, string|ArrayBuffer>} the files the builder may load
 */
export const buildFiles = (files = {}) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => !isTestOrNotesPath(path)))

// What a delete answers: its build report, headed by the file deleted, in the
// app and the eval alike, so a failed build after the removal never reads as a
// lost delete.
export const deleteReport = (path, report) => {
  let note
  if (report.ok && report.entry === null) note = `deleted; ${report.note}`
  else if (!report.ok && typeof report.entry === 'string') note = `${path} is deleted; the build of ${report.entry} failed`
  return { deleted: path, ...report, ...(note ? { note } : {}) }
}
