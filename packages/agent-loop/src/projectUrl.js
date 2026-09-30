// Project files load under a synthetic base so the loader can tell a project
// file from a CDN package by URL alone, in the app's frame and the eval alike.
export const PROJECT_BASE = 'http://project.local/'

// The file a scratch `run` snippet runs as, beside the project's files.
export const RUN_FILE = '__run__.js'

/**
 * The readFile `@jscadui/require` calls: a project URL resolves from `files`
 * and a missing one throws the text a 404 gives; any other path goes to
 * `fetchFile`, which the frame points at the CDN and the eval at node_modules.
 * @param {Record<string, unknown>} files
 * @param {(path:string, options?:object) => unknown} fetchFile
 */
export const createReadFile = (files, fetchFile) => (path, options) => {
  if (path.startsWith(PROJECT_BASE)) {
    const projectPath = path.slice(PROJECT_BASE.length)
    if (Object.hasOwn(files, projectPath)) return files[projectPath]
    throw new Error(`file not found ${path}`)
  }
  if (Object.hasOwn(files, path)) return files[path]
  return fetchFile(path, options)
}
