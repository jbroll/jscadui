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
 * edits. A write or edit is a save: it lands in the cache and the editor,
 * then `build` runs the project the way the editor does and answers its
 * report. Storage gets one version per turn, from `endTurn`.
 * @param {{
 *   getProjectFiles: () => Promise<Record<string, string|ArrayBuffer>>,
 *   writeProjectFile: (path:string, content:string) => Promise<void>,
 *   showFile: (path:string, content:string, files:Record<string, string|ArrayBuffer>) => void,
 *   build: () => Promise<object>,
 *   noGeometry: () => Promise<object|null>,
 *   workerApi: object,
 *   exportModel: (args:object) => Promise<object>,
 *   getProjectId: () => string,
 *   saveVersion: (projectId:string, files:Record<string,string>) => Promise<unknown>,
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
  saveVersion,
  getApi = () => DEFAULT_API,
  loadIndex = async () => undefined,
}) => {
  // project id → path → content written this turn
  const pending = new Map()

  const save = async ({ files, path }) => {
    const content = files[path]
    await writeProjectFile(path, content)
    const projectId = getProjectId()
    if (!pending.has(projectId)) pending.set(projectId, new Map())
    pending.get(projectId).set(path, content)
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
    // Paths this turn wrote and has not saved yet, which a load's storage merge must not overwrite.
    pendingPaths: (projectId) => new Set(pending.get(projectId)?.keys() ?? []),
    endTurn: async () => {
      const turns = [...pending]
      pending.clear()
      for (const [projectId, files] of turns) await saveVersion(projectId, Object.fromEntries(files))
    },
  }
}
