// The frame worker's importData (src_frame/importData.js) reads these as
// binary, so only these cross as ArrayBuffer.
const BINARY_EXT = new Set(['stl', 'ttf', 'otf'])

/** @param {string} path */
export const isBinaryPath = (path) => BINARY_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

/**
 * The project file an editor path names, or null for a URL (an example or a
 * remote script).
 * @param {string} path
 */
export const projectPathOf = (path) => (/^[a-z][a-z\d+.-]*:/i.test(path) ? null : path.replace(/^\//, ''))

/**
 * The frame's worker is on another origin, so the file service worker cannot
 * serve it: a service worker only sees fetches from clients it controls. The
 * project travels in the message instead.
 *
 * addToCache() puts entries under `new Request(path)` where path is a
 * leading-slash, project-relative path (e.g. `/index.js`); against the
 * document origin that resolves to no `sw.base`/swfs prefix at all, just the
 * bare pathname. Keys here drop only that leading slash, matching the
 * leading-slash-free lookup in src_frame/fileMap.js's createReadFile.
 * @param {{base:string,cache:Cache}|undefined} sw
 * @returns {Promise<Record<string,string|ArrayBuffer>>}
 */
/**
 * Make the cache hold exactly this project. Without the clear the frame gets
 * the union of every project opened this session, since collectProjectFiles
 * sends whatever is in the cache.
 * @param {{clearProjectCache:()=>Promise<void>,addToCacheWrapper:(path:string,content:unknown)=>Promise<void>}} fileSystem
 * @param {Record<string,unknown>} files
 */
export const replaceProjectFiles = async (fileSystem, files) => {
  await fileSystem.clearProjectCache()
  for (const [path, content] of Object.entries(files)) {
    await fileSystem.addToCacheWrapper(path, content)
  }
}

/**
 * The editor's file list: each file named by its leading-slash path.
 * @param {Record<string,unknown>} files
 */
export const toEditorFiles = (files) =>
  Object.entries(files).map(([path, content]) =>
    Object.assign(new File([/** @type {BlobPart} */ (content)], path.split('/').pop()), { fullPath: `/${path}` }),
  )

/**
 * Open a stored project: the cache, the editor and the caller's open-project
 * state all hold it, then its entry builds.
 * @param {{
 *   manager: { readForSwitch: (id:string) => Promise<{ project: { entry: string }, files: Record<string,unknown> }> },
 *   fileSystem: Parameters<typeof replaceProjectFiles>[0],
 *   editor: { setFiles: (files:File[]) => void, setSource: (source:unknown, path:string) => void },
 *   clearTempCache: () => void,
 *   build: (entry:string) => Promise<unknown>,
 *   onOpen: (id:string, entry:string) => void,
 *   onError: (err:unknown) => void,
 * }} deps
 */
export const createProjectSwitch = ({ manager, fileSystem, editor, clearTempCache, build, onOpen, onError }) => async (id) => {
  const { project, files } = await manager.readForSwitch(id)
  onOpen(id, project.entry)
  clearTempCache()
  await replaceProjectFiles(fileSystem, files)
  editor.setFiles(toEditorFiles(files))
  editor.setSource(files[project.entry] ?? '', project.entry)
  build(project.entry).catch(onError)
}

export const collectProjectFiles = async (sw) => {
  if (!sw?.cache) return {}
  const files = {}
  for (const request of await sw.cache.keys()) {
    const path = new URL(request.url).pathname.replace(/^\//, '')
    const response = await sw.cache.match(request)
    if (!response) continue
    files[path] = isBinaryPath(path) ? await response.arrayBuffer() : await response.text()
  }
  return files
}
