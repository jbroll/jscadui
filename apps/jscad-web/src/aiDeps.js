import { applyEdit, applyWrite, DEFAULT_API, listFiles, readFile, withUnits } from '@jscadui/agent-loop'
import { PROJECT_BASE } from '../src_frame/fileMap.js'
import { reportError } from './projectBuild.js'
import { sendScript } from './scriptRuns.js'

// The file a scratch `run` snippet runs as, beside the project's files, as in the eval's backend.
const RUN_FILE = '__run__.js'

// With no index the error goes out without its hint.
const indexFor = async (loadIndex) => {
  try {
    return await loadIndex()
  } catch {
    return undefined
  }
}

/**
 * The chat's tools over the open project: the file cache every run sends the
 * frame, read at each call so it follows project switches and the user's
 * edits. A write or edit is a save: it lands in the cache, in storage and in
 * the editor, then `build` runs the project the way the editor does and
 * answers its report. `storeFile` writes with no version row; `endTurn`
 * snapshots each project the turn wrote to as one version.
 * @param {{
 *   getProjectFiles: () => Promise<Record<string, string|ArrayBuffer>>,
 *   writeProjectFile: (path:string, content:string) => Promise<void>,
 *   showFile: (path:string, content:string, files:Record<string, string|ArrayBuffer>) => void,
 *   build: () => Promise<object>,
 *   noGeometry: () => Promise<object|null>,
 *   workerApi: object,
 *   exportModel: (args:object) => Promise<object>,
 *   getProjectId: () => string,
 *   storeFile: (projectId:string, path:string, content:string) => Promise<unknown>,
 *   snapshot: (projectId:string) => Promise<unknown>,
 *   getApi?: () => string,
 *   loadIndex?: () => Promise<Array<object>|undefined>,
 * }} deps
 */
export const createProjectTools = ({
  getProjectFiles,
  writeProjectFile,
  showFile,
  build,
  noGeometry,
  workerApi,
  exportModel,
  getProjectId,
  storeFile,
  snapshot,
  getApi = () => DEFAULT_API,
  loadIndex = async () => undefined,
}) => {
  // The projects this turn wrote to.
  const written = new Set()

  const save = async ({ files, path }) => {
    const content = files[path]
    const projectId = getProjectId()
    await writeProjectFile(path, content)
    await storeFile(projectId, path, content)
    written.add(projectId)
    showFile(path, content, files)
    return build()
  }

  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const api = getApi()
    const files = { ...(await getProjectFiles()), [RUN_FILE]: source }
    const request = { script: source, url: PROJECT_BASE + RUN_FILE, base: PROJECT_BASE, root: PROJECT_BASE, scratch: true }
    const result = await sendScript(workerApi, files, request, api)
    const out = { warnings: result.warnings ?? [], console: result.console ?? [] }
    if (result.error) return { ok: false, error: reportError(result.error, { api, index: await indexFor(loadIndex) }), ...out }
    return {
      ok: true,
      ...out,
      ...(result.geometry ? { geometry: result.geometry } : {}),
      ...(result.returned !== undefined ? { returned: result.returned } : {}),
    }
  }

  const onBuild = (tool) => async (args) => (await noGeometry()) ?? tool(args)

  return {
    list: async () => listFiles(await getProjectFiles()),
    read: async (args) => readFile(await getProjectFiles(), args),
    write: async (args) => save(applyWrite(await getProjectFiles(), args)),
    edit: async (args) => save(applyEdit(await getProjectFiles(), args)),
    run,
    measure: onBuild(async (options) => withUnits({ ok: true, ...(await workerApi.jscadMeasure({ options })) })),
    check: onBuild(async (input) => withUnits({ ok: true, ...(await workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} })) })),
    exportModel: onBuild(exportModel),
    endTurn: async () => {
      for (const projectId of [...written]) {
        written.delete(projectId)
        await snapshot(projectId)
      }
    },
  }
}
