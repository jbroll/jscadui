// The project file operations behind the list, read, write and edit tools,
// shared by the eval backend and the app so both answer the same way. A
// project is a map of project-relative paths to file text.
export const PACKAGE_JSON = 'package.json'
export const READ_LIMIT = 2000
export const NO_ENTRY = 'no entry file: write main.js, or index.js, or name the entry in package.json "main"'

const named = (name, message) => Object.assign(new Error(message), { name })

// `./a/b.js`, `/a/b.js` and `a//b.js` are all `a/b.js`; nothing leaves the project.
export const projectPath = (path) => {
  if (typeof path !== 'string' || path.trim() === '') throw named('PathError', 'path must be a project file path such as main.js')
  const parts = path.trim().split('/').filter((part) => part !== '' && part !== '.')
  if (parts.includes('..')) throw named('PathError', `path ${path} leaves the project; use a path inside it such as main.js`)
  if (parts.length === 0) throw named('PathError', `path ${path} names no file`)
  return parts.join('/')
}

const textOf = (files, path) => {
  const text = files[path]
  if (typeof text !== 'string') throw named('FileNotFoundError', `no file ${path} in the project; list shows the files`)
  return text
}

const mainCandidates = (main) => [main, `${main}.js`, `${main}/index.js`]

// Node's rule: package.json `main`, else index.js, else main.js. A `main`
// naming no file is still the entry, so the build says it is missing.
export const resolveEntry = (files) => {
  const pkg = files[PACKAGE_JSON]
  if (typeof pkg === 'string') {
    let main
    try {
      main = projectPath(JSON.parse(pkg)?.main)
    } catch {
      main = undefined
    }
    if (main) return mainCandidates(main).find((path) => typeof files[path] === 'string') ?? main
  }
  return ['index.js', 'main.js'].find((path) => typeof files[path] === 'string') ?? null
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
