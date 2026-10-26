import { applyDelete, applyEdit, applyWrite, buildFiles, buildReport, DEFAULT_API, deleteReport, firstError, isCodePath, lintSource, listFiles, PROJECT_BASE, readFile, reportError, resolveEntry, RUN_FILE, runTimeoutError, searchFiles, summarizeTestRun, withUnits, writeReport } from '@jscadui/agent-loop'
import { indexFor } from './projectBuild.js'
import { sendScript } from './scriptRuns.js'
import { defaultCreateWorker, runProjectTests } from './testWorker.js'

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
 * answers its report — plus, for a `.js` file outside `test/` and `notes/`,
 * the full `test/` suite off the test worker, merged as `{build, tests}`
 * with a coverage note. Docs, notes and test files skip tests. `delete` removes a file the same way, out of the cache,
 * storage and the editor, so a reload mid-turn keeps it deleted; a delete of a
 * file that is not there answers ok and changes nothing. `storeFile` writes
 * with no version row; `endTurn` snapshots each project the turn wrote to,
 * deletes included, as one version, naming it with the turn's excerpt. After
 * `startTurn`, a write, edit or delete is refused once another project is
 * open: the turn's context came from the project open when it started.
 * @param {{
 *   getProjectFiles: () => Promise<Record<string, string|ArrayBuffer>>,
 *   writeProjectFile: (path:string, content:string) => Promise<void>,
 *   removeProjectFile: (path:string) => Promise<void>,
 *   showFile: (path:string, content:string, files:Record<string, string|ArrayBuffer>) => void,
 *   showFiles: (files:Record<string, string|ArrayBuffer>) => void,
 *   build: () => Promise<object>,
 *   noGeometry: () => Promise<object|null>,
 *   recordGated?: (report:object) => void,
 *   workerApi: object,
 *   exportModel: (args:object) => Promise<object>,
 *   getProjectId: () => string,
 *   storeFile: (projectId:string, path:string, content:string) => Promise<unknown>,
 *   removeFile: (projectId:string, path:string) => Promise<unknown>,
 *   snapshot: (projectId:string, excerpt:string) => Promise<unknown>,
 *   pinTurnStart?: (projectId:string) => Promise<string|null>,
 *   getApi?: () => string,
 *   loadIndex?: () => Promise<Array<object>|undefined>,
 *   createTestWorker?: () => Worker,
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
  recordGated = () => {},
  workerApi,
  exportModel,
  getProjectId,
  storeFile,
  removeFile,
  snapshot,
  pinTurnStart = async () => null,
  getApi =() => DEFAULT_API,
  loadIndex = async () => undefined,
  createTestWorker,
}) => {
  // The projects this turn wrote to.
  const written = new Set()
  let turnProject
  // projectId -> promise of the version holding its files before this turn's first write.
  const pinned = new Map()

  const pinStart = (projectId) => {
    if (!pinned.has(projectId)) {
      const pin = pinTurnStart(projectId)
      pinned.set(projectId, pin)
      pin.catch(() => pinned.delete(projectId))
    }
    return pinned.get(projectId)
  }

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
    await pinStart(projectId)
    await writeProjectFile(path, content)
    await storeFile(projectId, path, content)
    written.add(projectId)
    showFile(path, content, files)
    const diagnostics = await lint(content)
    const blocked = path.endsWith('.js') ? firstError(diagnostics) : undefined
    if (blocked) {
      const entry = resolveEntry(buildFiles(files))
      const gated = mergeStatic(
        writeReport(
          path,
          buildReport({
            entry,
            error: { name: 'SyntaxError', message: blocked.message, file: path, line: blocked.line, column: blocked.column },
            warnings: [],
            console: [],
            params: [],
          }),
        ),
        diagnostics,
      )
      recordGated(gated)
      if (!isCodePath(path)) return gated
      const createWorker = createTestWorker ?? defaultCreateWorker({})
      const run = await runProjectTests(files, getApi(), createWorker ? { createWorker } : {})
      const { tests, coverageNote } = summarizeTestRun(run, gated.geometry?.parts)
      return { ...gated, ok: gated.ok && tests.ok, build: gated, tests, coverageNote }
    }
    const report = mergeStatic(writeReport(path, await build()), diagnostics)
    // Docs, notes and the test files themselves skip tests; every other `.js`
    // write runs the full `test/` suite after the build. The geometry builder
    // (main.js buildProject into the frame's jscadScript) executes the entry
    // script only — test/ and notes/ sit in the frame's file cache for lazy
    // requires but never run as geometry — so the exclusion this layer owns
    // is which writes trigger a test run. A red build stays saved: the run
    // still answers, with ok false.
    if (!isCodePath(path)) return report
    // Production runs off-thread on the bundled test worker, so a hanging
    // test burns the kill timer instead of freezing the viewer; the in-thread
    // fallback serves only environments without a browser Worker. Tests may
    // inject a factory.
    const createWorker = createTestWorker ?? defaultCreateWorker({})
    const run = await runProjectTests(files, getApi(), createWorker ? { createWorker } : {})
    const { tests, coverageNote } = summarizeTestRun(run, report.geometry?.parts)
    return { ...report, ok: report.ok && tests.ok, build: report, tests, coverageNote }
  }

  const remove = async (args) => {
    const removal = applyDelete(await getProjectFiles(), args)
    if (!removal.deleted) return { ok: true }
    const projectId = getProjectId()
    if (turnProject !== undefined && projectId !== turnProject) {
      throw Object.assign(new Error('the user opened another project during this turn; nothing was deleted. Stop and tell the user.'), { name: 'ProjectSwitchedError' })
    }
    await pinStart(projectId)
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
    if (result.error) return mergeStatic({ ok: false, error: reportError(result.error, { api, index: await indexFor(loadIndex), files }), ...out }, diagnostics)
    return mergeStatic({
      ok: true,
      ...out,
      ...(result.geometry ? { geometry: result.geometry } : {}),
      ...(result.returned !== undefined ? { returned: result.returned } : {}),
    }, diagnostics)
  }

  const onBuild = (tool) => async (args) => (await noGeometry()) ?? tool(args)

  return {
    list: async (args) => listFiles(await getProjectFiles(), args),
    read: async (args) => readFile(await getProjectFiles(), args),
    search: async (args) => searchFiles(await getProjectFiles(), args),
    write: async (args) => save(applyWrite(await getProjectFiles(), args)),
    edit: async (args) => save(applyEdit(await getProjectFiles(), args)),
    deleteFile: remove,
    run,
    measure: onBuild(async (options) => withUnits({ ok: true, ...(await workerApi.jscadMeasure({ options })) })),
    check: onBuild(async (input) => withUnits({ ok: true, ...(await workerApi.jscadCheck({ bed: input?.bed })) })),
    exportModel: onBuild(exportModel),
    startTurn: () => {
      turnProject = getProjectId()
      pinned.clear()
    },
    endTurn: async (excerpt = '') => {
      const starts = []
      for (const projectId of [...written]) {
        written.delete(projectId)
        starts.push({ projectId, versionId: (await pinned.get(projectId)) ?? null })
        await snapshot(projectId, excerpt)
      }
      pinned.clear()
      return starts
    },
  }
}
