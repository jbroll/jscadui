// Project files live under a synthetic base so the loader can tell a project
// file from a CDN package by URL alone. The worker resolves every sibling
// require to an absolute URL against this base before calling readFile.
export const PROJECT_BASE = 'http://project.local/'

/**
 * Synchronous fetch for paths outside the project (bare packages resolve to
 * CDN URLs before reaching readFile). Mirrors readFileWeb but uses the absolute
 * URL directly: readFileWeb's `new URL(path, self.location.origin)` base is
 * invalid inside a blob worker, where the origin is 'null'.
 */
const fetchText = (path, { output = 'text' } = {}) => {
  const req = new XMLHttpRequest()
  req.open('GET', path, 0)
  if (output !== 'text') {
    req.overrideMimeType('text/plain; charset=x-user-defined')
  }
  req.send()
  if (req.status === 0) {
    throw new Error(`network error fetching ${path}`)
  }
  if (req.status === 404) {
    throw new Error(`file not found ${path}`)
  }
  if (req.status !== 200) {
    throw new Error(`failed to fetch file ${path} ${req.status} ${req.statusText}`)
  }
  return output === 'text' ? req.responseText : req.response
}

/**
 * Build the readFile the worker passes into require. A project path resolves
 * from the file map; a missing one throws in the shape require expects; any
 * other path (bare package name, absolute CDN URL) falls through to fetchFile.
 * @param {Record<string, string>} files
 * @param {(path: string, options?: { output?: string }) => string} [fetchFile]
 * @returns {(path: string, options?: { output?: string }) => string}
 */
export const createReadFile = (files, fetchFile = fetchText) => (path, options) => {
  if (path.startsWith(PROJECT_BASE)) {
    const projectPath = path.slice(PROJECT_BASE.length)
    if (Object.hasOwn(files, projectPath)) return files[projectPath]
    throw new Error(`file not found ${path}`)
  }
  if (Object.hasOwn(files, path)) return files[path]
  return fetchFile(path, options)
}