import { applyDelete, applyEdit, applyWrite, DEFAULT_API, deleteReport, lintSource, listFiles, PROJECT_BASE, readFile, reportError, RUN_FILE, runTimeoutError, withUnits, writeReport } from '@jscadui/agent-loop'
import { indexFor } from './projectBuild.js'
import { sendScript } from './scriptRuns.js'

const staticWarnings = (diagnostics) => diagnostics.map(({ from: _from, to: _to, ...rest }) => ({ ...rest, source: 'static' }))

// The runtime option checks and the static lint see the same mistake; keep the
// runtime entry (it carries the hint) and add only what it did not report.
const mergeStatic = (result, diagnostics) => {
  if (!diagnostics.length) return result
  const runtime = result.warnings ?? []
  const covered = new Set(runtime.filter((warning) => warning.option).map((warning) => `${warning.fn}\u0000${warning.option}`))
  const added = staticWarnings(diagnostics).filter((warning) => !(warning.option && covered.has(`${warning.fn}\u0000${warning.option}`)))
  return added.length ? { ...result, warnings: [...runtime, ...added] } : result
}

/**
 * The chat's tools over the open project: the file cache every run sends the
 * frame, read at each call so it follows project switches and the user's
 * edits. A write or edit is a save: it lands in the cache, in storage and in
 * the editor, then `build` runs the project the way the editor does and
 * answers its report. `delete` removes a file the same way, out of the cache,
 * storage and the editor, so a reload mid-turn keeps it deleted; a delete of a
 * file that is not there answers ok and changes nothing. `storeFile` writes
 * with no version row; `endTurn` snapshots each project the turn wrote to,
 * deletes included, as one version. After `startTurn`, a write, edit or delete
 * is refused once another project is open: the turn's context came from the
 * project open when it started.
 * @param {{
 *   getProjectFiles: () => Promise<Record<string, string|ArrayBuffer>>,
 *   writeProjectFile: (path:string, content:string) => Promise<void>,
 *   removeProjectFile: (path:string) => Promise<void>,
 *   showFile: (path:string, content:string, files:Record<string, string|ArrayBuffer>) => void,
 *   showFiles: (files:Record<string, string|ArrayBuffer>) => void,
 *   build: () => Promise<object>,
 *   noGeometry: () => Promise<object|null>,
 *   workerApi: object,
 *   exportModel: (args:object) => Promise<object>,
 *   getProjectId: () => string,
 *   storeFile: (projectId:string, path:string, content:string) => Promise<unknown>,
 *   removeFile: (projectId:string, path:string) => Promise<unknown>,
 *   snapshot: (projectId:string) => Promise<unknown>,
 *   getApi?: () => string,
 *   loadIndex?: () => Promise<Array<object>|undefined>,
 * }} deps
 */
export const createProjectTools = ({
  getProjectFiles,
  writeProjectFile,
  removeProjectFile,
  showFile,
  showFiles,
  build,
  noGeometry,
  workerApi,
  exportModel,
  getProjectId,
  storeFile,
  removeFile,
  snapshot,
  getApi = () => DEFAULT_API,
  loadIndex = async () => undefined,
}) => {
  // The projects this turn wrote to.
  const written = new Set()
  let turnProject

  const lint = async (content) => {
    if (typeof content !== 'string') return []
    const index = await indexFor(loadIndex)
    if (!index) return []
    try {
      return await lintSource(index, content, { api: getApi() })
    } catch {
      return []
    }
  }

  const save = async ({ files, path }) => {
    const content = files[path]
    const projectId = getProjectId()
    if (turnProject !== undefined && projectId !== turnProject) {
      throw Object.assign(new Error('the user opened another project during this turn; nothing was written. Stop and tell the user.'), { name: 'ProjectSwitchedError' })
    }
    await writeProjectFile(path, content)
    await storeFile(projectId, path, content)
    written.add(projectId)
    showFile(path, content, files)
    return mergeStatic(writeReport(path, await build()), await lint(content))
  }

  const remove = async (args) => {
    const removal = applyDelete(await getProjectFiles(), args)
    if (!removal.deleted) return { ok: true }
    const projectId = getProjectId()
    if (turnProject !== undefined && projectId !== turnProject) {
      throw Object.assign(new Error('the user opened another project during this turn; nothing was deleted. Stop and tell the user.'), { name: 'ProjectSwitchedError' })
    }
    await removeProjectFile(removal.path)
    await removeFile(projectId, removal.path)
    written.add(projectId)
    showFiles(removal.files)
    return deleteReport(removal.path, await build())
  }

  const run = async (source) => {
    if (typeof source !== 'string') throw Object.assign(new Error('source must be the snippet text, a string'), { name: 'TypeError' })
    const api = getApi()
    const files = { ...(await getProjectFiles()), [RUN_FILE]: source }
    const request = { script: source, url: PROJECT_BASE + RUN_FILE, base: PROJECT_BASE, root: PROJECT_BASE, scratch: true }
    let result
    try {
      result = await sendScript(workerApi, files, request, api)
    } catch (error) {
      // The frame stops a scratch run at RUN_TOOL_TIMEOUT_MS; the eval answers the same.
      if (error?.name === 'TimeoutError') return runTimeoutError()
      throw error
    }
    const out = { warnings: result.warnings ?? [], console: result.console ?? [] }
    const diagnostics = await lint(source)
    if (result.error) return mergeStatic({ ok: false, error: reportError(result.error, { api, index: await indexFor(loadIndex) }), ...out }, diagnostics)
    return mergeStatic({
      ok: true,
      ...out,
      ...(result.geometry ? { geometry: result.geometry } : {}),
      ...(result.returned !== undefined ? { returned: result.returned } : {}),
    }, diagnostics)
  }

  const onBuild = (tool) => async (args) => (await noGeometry()) ?? tool(args)

  return {
    list: async () => listFiles(await getProjectFiles()),
    read: async (args) => readFile(await getProjectFiles(), args),
    write: async (args) => save(applyWrite(await getProjectFiles(), args)),
    edit: async (args) => save(applyEdit(await getProjectFiles(), args)),
    deleteFile: remove,
    run,
    measure: onBuild(async (options) => withUnits({ ok: true, ...(await workerApi.jscadMeasure({ options })) })),
    check: onBuild(async (input) => withUnits({ ok: true, ...(await workerApi.jscadCheck({ bed: input?.bed })) })),
    exportModel: onBuild(exportModel),
    startTurn: () => {
      turnProject = getProjectId()
    },
    endTurn: async () => {
      for (const projectId of [...written]) {
        written.delete(projectId)
        await snapshot(projectId)
      }
    },
  }
}
