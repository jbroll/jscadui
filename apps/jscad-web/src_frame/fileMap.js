import { createReadFile as readFrom } from '@jscadui/agent-loop/src/projectUrl.js'

export { PROJECT_BASE } from '@jscadui/agent-loop/src/projectUrl.js'

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
 * The readFile the worker passes into require: agent-loop's, the eval's too,
 * with any path outside the project (bare package name, absolute CDN URL) fetched.
 * @param {Record<string, string>} files
 * @param {(path: string, options?: { output?: string }) => string} [fetchFile]
 * @returns {(path: string, options?: { output?: string }) => string}
 */
export const createReadFile = (files, fetchFile = fetchText) => readFrom(files, fetchFile)