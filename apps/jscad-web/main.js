/**
 * JSCAD Web Application - Main Entry Point
 *
 * This module wires together the application components:
 * - View/Camera controls
 * - Worker communication
 * - File system handling
 * - Parameter UI
 * - Script loading
 */

// Global error handlers - catch unhandled errors and rejections
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

// External dependencies
import { Gizmo } from '@jscadui/html-gizmo'
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- OrbitState used in JSDoc types
import { OrbitControl, OrbitState } from '@jscadui/orbit'
import { boundingBox } from '@jscadui/format-common'

// Local modules
import defaultCode from './examples/jscad/01-two-cars.example.js'
import hierarchicalCarCode from './examples/jscad/02-hierarchical-car.example.js'
import { addV1Shim } from './src/addV1Shim.js'
import * as editor from './src/editor.js'
import { confirm } from './src/ui/dialog.js'
import * as engine from './src/engine.js'
import * as exporter from './src/exporter.js'
import * as menu from './src/menu.js'
import { currentBuildHash, watchBuildHash } from './src/buildVersion.js'
import * as remote from './src/remote.js'
import { setError } from './src/error.js'
import { ViewState } from './src/viewState.js'
import * as welcome from './src/welcome.js'
import * as about from './src/about.js'
import { showTrustedSourcesDialog, trustedSourcesStyles } from './src/trustedSourcesUI.js'
import { showDemoBrowser, demoBrowserStyles } from './src/demoBrowser.js'
import { showPartsBrowser, partsBrowserStyles } from './src/partsBrowser.js'

// Extracted modules
import { updatePipelineStats, countGeometry, createProgressHandler } from './src/stats.js'
import { capGeometry, DEFAULT_CAPS } from './src/caps.js'
import { createProjectTools } from './src/aiDeps.js'
import { createProjectBuilds, projectEntry } from './src/projectBuild.js'
import { createExport } from './src/aiExport.js'
// Nothing here may import ./src/storage/schema.js: its zod 4 types are more
// than the root TS 4.9 gate can parse (see root tsconfig).
import { createLocalStorage } from './src/storage/local.js'
import { assembleFileMap } from './src/storage/map.js'
import { createProjectManager } from './src/storage/projects.js'
import { createSession } from './src/storage/session.js'
import { initProjects } from './src/projects.js'
import { extractEntries, readAsText, readDir } from '@jscadui/fs-provider'
import { createFrame, createJobTracker } from './src/frameSetup.js'
import { createProjectSwitch, defaultProjectFiles, isRecordablePath, loadSource, pickBootProject, projectPathOf, shouldRestoreBootProject, toEditorFiles } from './src/projectFiles.js'
import { createDiskProject, diskEntryFromHash, DISK_ID } from './src/diskProject.js'
import { createScriptRuns, sendScript } from './src/scriptRuns.js'
import { createStreamRuns } from './src/streamRuns.js'
import { newRunId } from './src/runId.js'
import { bindStopButton } from './src/runStop.js'
import { createMeshRefs } from './src/meshRefs.js'
import { PROJECT_BASE } from './src_frame/fileMap.js'
import * as fileSystem from './src/fileSystem.js'
import * as paramsUI from './src/paramsUI.js'
import { clearReloadTimestamp } from './src/reloadDetection.js'
import { missingSaveHandleMessage, saveRoute } from './src/saveFile.js'
import { createDocs, createIndexLoader } from './src/apiIndex.js'
import { showApiHelp, apiHelpStyles } from './src/apiHelp.js'
import { initChat } from './src/aiChat.js'
import { createSearchStores, createWebSearchHandler } from './src/aiSearch.js'
import { dispatchTool, NO_ENTRY } from '@jscadui/agent-loop'
import { initAccount, getChatApi, getProviderConfig, getSession, getWebsearchSelection } from './src/aiAccount.js'

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = id => /** @type {HTMLElement} */(document.getElementById(id))

// Use origin + '/' as base to ensure proper URL resolution
const appBase = location.origin + '/'
let currentBase = appBase

// ============== View & Camera Setup ==============
const viewState = new ViewState()
const gizmo = new Gizmo()
byId('layout').append(gizmo)

// Load default model unless another model was already loaded
let loadDefault = true

// ============== Menu & Welcome ==============
// Wired before the frame boot below: none of the chrome needs the frame, and a
// click landing during those awaits would be dropped rather than queued.
menu.init({
  onBrowseDemos: () => showDemoBrowser({
    baseUrl: new URL('./examples/', appBase).toString(),
    onLoad: async (script, url) => {
      if (!(await editor.confirmDiscard())) return
      editor.setSource(script, url)
      jscadScript({ script, url, base: new URL('./', new URL(url, appBase)).toString(), root: appBase })
      welcome.dismiss()
    },
  }),
  onBrowseParts: () => showPartsBrowser({
    catalogUrl: new URL('./parts/catalog.json', appBase).toString(),
    // editor.init() runs later, after the frame boot above; Insert must not
    // call into a CodeMirror view that doesn't exist yet.
    getEditor: () => (editor.isReady() ? editor : null),
  })
})
welcome.init()
about.init()

// Build hash in the Options line, and a reload affordance when a deploy lands
// mid-session: entry documents are no-cache, but long-lived tabs keep
// running the frame they booted with.
{
  const versionEl = byId('build-version')
  const bootHash = await currentBuildHash().catch(() => null)
  if (bootHash) {
    console.log('build', bootHash)
    if (versionEl) {
      versionEl.textContent = bootHash
      versionEl.title = `this page runs build ${bootHash}`
    }
    watchBuildHash({
      current: bootHash,
      onNewVersion: (latest) => {
        if (!versionEl) return
        versionEl.textContent = 'New version'
        versionEl.title = `build ${latest} is served: click to reload`
        versionEl.classList.add('update-available')
        versionEl.onclick = () => location.reload()
      },
    })
  }
}

// Trusted Sources dialog
const trustedSourcesBtn = byId('trusted-sources-btn')
if (trustedSourcesBtn) {
  trustedSourcesBtn.addEventListener('click', showTrustedSourcesDialog)
}

// Inject dialog styles
const trustedStyles = document.createElement('style')
trustedStyles.textContent = trustedSourcesStyles + '\n' + demoBrowserStyles + '\n' + partsBrowserStyles + '\n' + apiHelpStyles
document.head.appendChild(trustedStyles)

const ctrl = new OrbitControl([byId('viewer')], { ...viewState.camera })

/** @param {OrbitState} change */
const updateFromCtrl = change => {
  const { position, target, rx, rz } = change
  viewState.setCamera({ position, target })
  gizmo.rotateXZ(rx, rz)
}
updateFromCtrl(ctrl)

ctrl.onchange = (/** @type {OrbitState} */ state) => viewState.saveCamera(state)
ctrl.oninput = (/** @type {OrbitState} */ state) => updateFromCtrl(state)
gizmo.onRotationRequested = (/** @type {string} */ cam) => ctrl.animateToCommonCamera(cam)

// ============== Stats & Progress ==============
const statsContent = byId('stats-content')
const progress = /** @type {HTMLProgressElement} */ (byId('progress'))
const onProgress = createProgressHandler(progress)

/** @type {{ setRunning: (running: boolean) => void, setCells: (count: number) => void } | null} */
let stopCtl = null

// ============== Params Controller ==============
const paramsCtrl = paramsUI.initParamsController()
// The frame's worker defaults to the flat params form; the app always uses the
// proxy, so it must say so on every init.
const useParamsProxy = true

// ============== Compute Frame Setup ==============

/**
 * Handle entities from worker
 * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
 * @param {{skipLog?:boolean }} options
 * @returns {unknown} the error, when the result was refused rather than drawn
 */
const handleEntities = (result, { skipLog } = {}) => {
  if (result?.streamed) {
    // null for another run's result, or one a cap error already ended
    const totals = streamRuns.finish(result.runId, result.lost)
    if (!totals) return streamError ?? undefined
    meshRefs.remember(streamDrawn)
    onProgress(undefined)
    document.documentElement.dataset.vertices = String(totals.vertices)
    if (!totals.lost) setError(undefined)
    updatePipelineStats(statsContent, { treeTime: result.treeTime, triangles: totals.triangles, vertices: totals.vertices })
    if (!skipLog) console.debug('streamed', totals.cells, 'cells, tree:', result.treeTime?.toFixed(2))
    return
  }
  streamRuns.discard()
  const { entities: rawEntities, treeTime, execTime, convTime } = result

  // Refuse to draw past the caps before any allocation for rendering.
  let entities
  try {
    entities = capGeometry(meshRefs.resolve(rawEntities instanceof Array ? rawEntities : [rawEntities]), DEFAULT_CAPS)
  } catch (error) {
    setError(error)
    onProgress(undefined)
    return error
  }

  // Track render time
  const renderStart = performance.now()
  viewState.setModel(entities)
  const renderTime = performance.now() - renderStart
  meshRefs.remember(entities)

  if (viewState.zoomToFit) {
    const { min, max } = boundingBox(entities)
    const { fov, aspect } = viewState.viewer.getCamera()
    ctrl.fit(min, max, fov, aspect, 1 / 0.6)  // model fills ~60% of viewport
  }

  if (!skipLog) {
    console.debug('tree:', treeTime?.toFixed(2), ', exec:', execTime?.toFixed(2), ', conv:', convTime?.toFixed(2), ', render:', renderTime?.toFixed(2), entities)
  }

  // Read by the render sweep, which must tell an empty model from a render
  const { triangles, vertices } = countGeometry(entities)
  document.documentElement.dataset.vertices = String(vertices)

  setError(undefined)
  onProgress(undefined)

  updatePipelineStats(statsContent, { treeTime, execTime, convTime, renderTime, triangles, vertices })
}

const meshRefs = createMeshRefs()

// Remembered only when the run finishes: its later batches still refer to the previous model's meshes.
let streamDrawn = []

// A grid draws cell by cell; the camera refits to what is drawn, so it only zooms out.
const drawStream = (entities, box) => {
  viewState.setModel(entities)
  streamDrawn = entities
  if (viewState.zoomToFit && box) {
    const { fov, aspect } = viewState.viewer.getCamera()
    ctrl.fit(box.min, box.max, fov, aspect, 1 / 0.6)
  }
}

// The error that ended the current streamed run, which its load reports as the build's.
let streamError = null

const streamRuns = createStreamRuns({
  draw: drawStream,
  resolve: meshRefs.resolve,
  // Read by the render sweep, which restarts its hang guard on each cell
  onCells: count => {
    document.documentElement.dataset.cells = String(count)
    stopCtl?.setCells(count)
  },
  onError: error => {
    streamError = error
    setError(error)
    onProgress(undefined)
  },
})

/**
 * @param {() => boolean} isStale
 * @returns {string} the runId to send with the request, which the worker echoes on its cells
 */
const beginStream = isStale => {
  const runId = newRunId()
  delete document.documentElement.dataset.cells
  // A new run starts at zero cells: clearing the count stops the previous run's
  // total from showing until the first batch of the new one arrives.
  stopCtl?.setCells(null)
  streamError = null
  streamRuns.begin(isStale, runId)
  return runId
}

const trackJobs = createJobTracker(progress, onProgress, (jobs) => stopCtl?.setRunning(jobs > 0))

// Every model — the editor's and the agent's — runs in the sandboxed frame.
// Its opaque origin means no cookies, no storage and no same-origin fetch.
/* global __FRAME_ORIGIN__ */
const { workerApi, handlers, destroy: destroyFrame } = await createFrame({
  onError: setError,
  onEntities: handleEntities,
  onJobCount: trackJobs,
  onCells: (entities, runId) => streamRuns.accept(entities, runId),
  // No onTerminated re-init: frameSetup replays the inits itself, and an init
  // sent on every restart loops forever when the init is what timed out.
  runOrigin: __FRAME_ORIGIN__,
})

stopCtl = bindStopButton({ button: byId('stop-button'), workerApi, onError: setError })

// Twice the old agent cap: the heaviest examples in the corpus finish well
// inside it, and a runaway model still dies rather than wedging the frame.
// The render sweep raises it: there the point is whether a model is correct,
// not whether it is quick, and the cap is only there to stop a hang.
const DEFAULT_EDITOR_TIMEOUT_MS = 120_000
const EDITOR_TIMEOUT_MS = (() => {
  try {
    const stored = Number(localStorage.getItem('engine.modelTimeoutMs'))
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_EDITOR_TIMEOUT_MS
  } catch (err) {
    console.warn('could not read engine.modelTimeoutMs:', err)
    return DEFAULT_EDITOR_TIMEOUT_MS
  }
})()

// The render sweep pins the frame's worker count to compare a pooled grid with one worker.
const POOL_SIZE = (() => {
  try {
    const stored = Number(localStorage.getItem('engine.poolSize'))
    return Number.isInteger(stored) && stored > 0 ? stored : undefined
  } catch (err) {
    console.warn('could not read engine.poolSize:', err)
    return undefined
  }
})()

// The api index loads on the first docs call or error hint that needs it.
const loadApiIndex = createIndexLoader()

// The report of the open project's last build, for the chat's header and its
// measure, check and export; see src/projectBuild.js.
const projectBuilds = createProjectBuilds({
  measure: () => workerApi.jscadMeasure({ options: {} }),
  check: () => workerApi.jscadCheck({ options: {} }),
  getApi: getChatApi,
  loadIndex: loadApiIndex,
})

// The frame names its own bundles; the app names only the engine.
const initFrame = () =>
  workerApi
    .jscadInit({ engine: viewState.modelingEngine, useParamsProxy, timeoutMs: EDITOR_TIMEOUT_MS, poolSize: POOL_SIZE })
    .catch(setError)

// A project's files travel to the frame in a map keyed by bare path, so a
// project script names itself against PROJECT_BASE; the app origin's /swfs/
// URLs are unreachable from the frame.
/** @param {string} path */
const projectUrls = path => ({
  url: PROJECT_BASE + String(path).replace(/^\//, ''),
  base: PROJECT_BASE,
  root: PROJECT_BASE,
})

// ============== File System Setup ==============
const dropModal = byId('dropModal')

/** @type {import('./src/fileSystem.js').FileSystemDeps} */
const fsDeps = {
  onFilesChange: () => reloadProject().catch(err => setError(err)), // Handle floating promise
  setEditorFiles: files => editor.setFiles(files, { keepBuffers: true }),
  onFilesChanged: files => editor.filesChanged(files),
  setError,
  onAliasFound: alias => workerApi.jscadInit({ alias }),
  onScriptReady: (script, url) => {
    currentEntry = url
    jscadScript(projectUrls(url))
    editor.setSource(script, url)
  },
  setProjectName: name => { exporter.exportConfig.projectName = name },
  addV1Shim,
  clearFileCache: files => workerApi.jscadClearFileCache({ files, root: PROJECT_BASE })
}

async function reloadProject() {
  workerApi.jscadClearTempCache()
  await fileSystem.reloadProject(fsDeps)
}

// Version/hash record for every editor compile and chat turn against the
// live project; the session routes by the manager's per-project mode.
const localStore = createLocalStorage()
let rowboatStore = null
// Only the launcher's build (JSCAD_LOCAL_FS=1) has /api/fs, the model directory it serves.
/* global __LOCAL_FS__ */
const diskStore = __LOCAL_FS__ ? (await import('./src/storage/disk.js')).createDiskStorage() : null
const projectManager = createProjectManager({ local: localStore, disk: diskStore, getRowboat: () => rowboatStore })
const storageSession = createSession({ local: localStore, disk: diskStore, getRowboat: () => rowboatStore, getBackend: (projectId) => projectManager.peekMode(projectId) })

// Editing a helper leaves the entry as it is; `entry` names a model the user ran on its own.
const recordEdit = async (script, path, { entry } = {}) => {
  if (!isRecordablePath(path)) return
  await storageSession.writeThrough(currentProjectId, path, script, { message: 'edit', ...(entry ? { entry } : {}) }).catch((err) => console.warn('storage write failed:', err))
}

let currentProjectId = 'default'
// The entry of whatever was opened last: a stored project or a dropped folder.
let currentEntry

// Assigned below, after the switch callback is defined; null until the chat
// mounts, so an early switch (a launcher model hash) skips it.
let chatControls = null

const switchProject = createProjectSwitch({
  manager: projectManager,
  fileSystem,
  editor,
  clearTempCache: () => workerApi.jscadClearTempCache(),
  build: (entry) => buildProject(entry),
  onOpen: (id, entry, name) => {
    currentProjectId = id
    currentEntry = entry
    if (typeof name === 'string' && name) exporter.exportConfig.projectName = name
    chatControls?.switchTo(id)
  },
  onError: setError,
})

const diskProject = diskStore && createDiskProject({
  store: diskStore,
  switchProject,
  isOpen: () => currentProjectId === DISK_ID,
  getEntry: () => currentEntry,
  fileSystem,
  clearFileCache: (files) => workerApi.jscadClearFileCache({ files, root: PROJECT_BASE }),
  editor,
  rebuild: () => buildProject().catch(setError),
})

// Lazy rowboat backend: built once a session exists, so anonymous users stay
// local-only and never load the rowboat client. Dynamic imports keep the
// TS 4.9 gate green (see above) and the rowboat bundle out of anonymous loads.
let rowboatStorePromise = null
let syncHandle = null

const fetchSyncToken = async () => {
  try {
    const res = await fetch('/api/sync-token', { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body?.token ? body : null
  } catch (err) {
    console.warn('could not fetch the sync token:', err)
    return null
  }
}

const getRowboatStore = async () => {
  if (!rowboatStorePromise) {
    rowboatStorePromise = (async () => {
      const user = await getSession()
      if (!user?.id) return null
      const info = await fetchSyncToken()
      if (!info) return null
      const { createRowboatStorage } = await import('./src/storage/rowboat.js')
      rowboatStore = createRowboatStorage({
        syncBase: info.syncBase,
        identity: user.id,
        getHeaders: async () => {
          const refreshed = await fetchSyncToken()
          return refreshed ? { authorization: `Bearer ${refreshed.token}` } : {}
        },
      })
      return rowboatStore
    })().catch((err) => {
      console.warn('rowboat init failed:', err)
      rowboatStorePromise = null
      return null
    })
  }
  return rowboatStorePromise
}

// Project panel mounts after the sync loop starts; callbacks reach it lazily.
let projectPanel = null

// Interval table sync while signed in; anonymous users never reach it.
const initSyncLoop = async () => {
  const store = await getRowboatStore()
  if (!store) return
  const { createSyncLoop } = await import('./src/storage/sync.js')
  syncHandle = createSyncLoop({
    storage: store,
    getToken: async () => (await fetchSyncToken())?.token ?? null,
    onError: (err) => {
      console.warn('rowboat sync failed:', err)
      projectPanel?.setSyncStatus('Sync failed')
    },
    onSync: () => projectPanel?.setSyncStatus(''),
  })
  syncHandle.start()
}

initSyncLoop()

fileSystem.setupDragDrop(dropModal, async (dataTransfer, target) => {
  // A real DataTransfer is cleared once the drop event's dispatch unwinds,
  // so read it once, up front, and reuse the entries for every route.
  const entries = await extractEntries(dataTransfer)
  const row = target?.closest?.('[data-project-id]')
  if (row) {
    await projectManager.mergeDrop(row.dataset.projectId, entries, { readDir, readAsText }).catch(setError)
    if (row.dataset.projectId === currentProjectId) await switchProject(currentProjectId).catch(setError)
    return
  }
  await fileSystem.handleFileDrop(dataTransfer, fsDeps, entries)
  if (entries.length === 1 && entries[0].isDirectory) {
    const created = await projectManager.createFromDrop(entries, { readDir, readAsText }).catch(setError)
    if (created) await switchProject(created.id).catch(setError)
  }
})

const scriptRuns = createScriptRuns()

// A superseded update must not draw: a whole result would also discard the newer run.
const modelUpdateDeps = () => {
  let isStale = () => false
  let runId
  return {
    workerApi,
    handleEntities: (result, options) => { if (!isStale()) handlers.entities(result, options) },
    setError,
    beginRun: () => {
      isStale = scriptRuns.paramChange()
      runId = beginStream(isStale)
      return runId
    },
    endRun: () => streamRuns.end(runId),
    discardRun: () => streamRuns.discard(),
    held: meshRefs.held,
  }
}

// The Reset control drops the user's edits: values return to the code's
// defaults, the tree collapses, and the model redraws them.
const resetParams = () => {
  const tree = paramsUI.getParamsTreeView()
  if (!tree) return
  paramsCtrl.params = { ...tree.reset() }
  paramsCtrl.userInteracted.clear()
  paramsUI.scheduleModelUpdate(() => paramsUI.runModelUpdate(modelUpdateDeps()))
}

// The zoom-to-fit toggle fits the camera to the model on screen; the model is
// not re-run for a camera change.
const fitViewToModel = () => {
  const entities = viewState.model
  if (!entities?.length) return
  const { min, max } = boundingBox(entities)
  const { fov, aspect } = viewState.viewer.getCamera()
  ctrl.fit(min, max, fov, aspect, 1 / 0.6)
}

viewState.onZoomToFit = fitViewToModel

// ============== Script Loading ==============

let lastScriptUrl
let lastLoadSource

const STALE = { stale: true }

/**
 * Load a script and draw it. Resolves to the load's outcome, `{ result }` or
 * `{ error }`, or `{ stale: true }` when a newer load replaced it; a load of a
 * project file is recorded as the project's build.
 * @param {{script?:string,url?:string,base?:string,root?:string,source?:string}} options
 */
const jscadScript = async ({ script, url = './jscad.model.js', base = currentBase, root }) => {
  const isStale = scriptRuns.load()
  const settled = (outcome) => {
    if (isStale()) return STALE
    projectBuilds.recordLoad(url, outcome)
    return outcome
  }
  if (url !== lastScriptUrl) meshRefs.forget()
  lastScriptUrl = url
  let runId = beginStream(isStale)
  currentBase = base
  loadDefault = false
  document.documentElement.dataset.render = 'running'
  delete document.documentElement.dataset.vertices

  // Capture the params, edits and expansion to carry: only a re-run of the
  // same model carries, so a freshly opened one starts from the new code's
  // defaults. The load identity is loadSource's: the url for a URL script,
  // `project:<projectId>` for a project file.
  const loadSourceId = loadSource({ url, projectId: currentProjectId })
  const sameModel = loadSourceId === lastLoadSource
  lastLoadSource = loadSourceId

  const savedParams = { ...paramsCtrl.params }
  const savedUserInteracted = [...paramsCtrl.userInteracted]
  const savedExpanded = paramsUI.getParamsTreeView()?.getExpandedPaths() ?? []

  // Reset controller and UI
  paramsCtrl.reset()
  paramsUI.destroyParamsTreeView()

  try {
    // Mixed local/rowboat models merge at load time: rowboat project files
    // land in the worker's file cache (its require path), each manifest path
    // naming exactly one backend. Unlisted sibling requires resolve
    // local-first through the service worker, then this rowboat cache.
    try {
      const store = await getRowboatStore()
      if (store) {
        const project = await store.readProject(currentProjectId).catch(() => null)
        if (project) {
          const manifest = Object.fromEntries(Object.keys(project.files).map((path) => [path, 'rowboat']))
          const merged = assembleFileMap(manifest, { local: {}, rowboat: project.files })
          for (const [path, content] of Object.entries(merged)) {
            await fileSystem.addToCacheWrapper(path, content)
          }
        }
      }
    } catch (err) {
      console.warn('rowboat merge failed:', err)
    }
    // Query renderer capability for GPU normals support
    const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
    const files = await fileSystem.projectFiles()
    if (isStale()) return STALE
    const result = await sendScript(workerApi, files, { script, url, base, root, source: loadSource({ url, projectId: currentProjectId }), useGpuNormals, runId, held: meshRefs.held(), supersede: true }, getChatApi())
    if (isStale()) return STALE

    if (result.proxyState) {
      paramsCtrl.initFromResult(result)

      // Restore the user's edits where the new code still declares the param,
      // so running the same model does not reset them to the code's defaults.
      const defaults = { ...paramsCtrl.params }
      const carried = paramsUI.carriedFromPrevious({
        sameModel,
        previous: savedParams,
        userInteracted: savedUserInteracted,
        expandedPaths: savedExpanded,
        defaults,
      })
      Object.assign(paramsCtrl.params, carried.values)
      for (const path of carried.userInteracted) {
        paramsCtrl.userInteracted.add(path)
      }

      // Setup UI
      const paramsHeader = byId('paramsHeader')
      const paramsDiv = byId('paramsDiv')
      paramsDiv.innerHTML = ''

      const { showHiddenCheckbox } = paramsUI.buildParamsHeader(paramsHeader, { onReset: resetParams })

      // Tree container
      const treeContainer = document.createElement('div')
      treeContainer.id = 'paramsTreeContainer'
      paramsDiv.appendChild(treeContainer)

      const state = paramsCtrl.getState()
      const paramsTreeView = paramsUI.createParamsTreeUI({
        target: treeContainer,
        proxyState: result.proxyState,
        state,
        expandedPaths: carried.expandedPaths,
        onChange: (paramPath, value) => {
          paramsUI.handleTreeParamChange(paramPath, value, () => {
            paramsUI.scheduleModelUpdate(() => paramsUI.runModelUpdate(modelUpdateDeps()))
          })
        },
        onClassChange: (partPath, newClass, mode) => {
          paramsUI.handleTreeClassChange(partPath, newClass, mode, modelUpdateDeps())
        }
      })

      showHiddenCheckbox.onchange = () => {
        paramsTreeView?.setShowHidden(showHiddenCheckbox.checked)
      }

      // The run above drew the code's defaults; a carried value that differs
      // needs one more run to draw.
      const carriedChanged = Object.entries(carried.values).some(([path, value]) => value !== defaults[path])
      if (carriedChanged) {
        runId = beginStream(isStale)
        const restoreResult = await workerApi.jscadMain({ ...paramsCtrl.getWorkerParams(), runId, held: meshRefs.held(), supersede: true })
        if (isStale()) return STALE
        const refused = handlers.entities(restoreResult)
        return settled(refused ? { error: refused } : { result })
      }
    }

    const refused = handlers.entities(result)
    return settled(refused ? { error: refused } : { result })
  } catch (err) {
    // A stop's AbortError drops the partial grid it interrupted instead of
    // flushing it; a stale run's stream already belongs to the newer run.
    if (err?.name === 'AbortError' && !isStale()) streamRuns.discard()
    else streamRuns.end(runId)
    if (isStale() || err?.name === 'SupersededError') return STALE
    setError(err)
    return settled({ error: err })
  }
}

/**
 * Build the open project: its entry (see projectEntry) run through the load
 * path above. The editor, a project switch and the chat's writes all build
 * this way, so each leaves the same report. The editor and a switch name the
 * file they open, which runs when it is a model of its own; the chat's builds
 * name none.
 * @param {string} [open]
 */
const buildProject = async (open) => {
  const files = await fileSystem.projectFiles()
  const entry = projectEntry(files, currentEntry, open)
  if (!entry) {
    projectBuilds.recordNoEntry()
    const error = Object.assign(new Error(NO_ENTRY), { name: 'NoEntryError' })
    setError(error)
    return { error }
  }
  // Files the chat wrote into an empty cache are the open project from then on.
  currentEntry ??= entry
  return jscadScript({ script: typeof files[entry] === 'string' ? files[entry] : undefined, ...projectUrls(entry) })
}

// ============== Engine Initialization ==============

// Initialize render engine first so we can query its capabilities
viewState.setEngine(await engine.init(viewState.renderEngine))

await initFrame()

// Set up engine change handler
viewState.onModelingEngineChange = async (newEngine) => {
  console.log('Switching modeling engine to:', newEngine)

  await initFrame()

  // Re-run script
  editor.runScript()
}

viewState.onRenderEngineChange = async (newEngine) => {
  console.log('Switching render engine to:', newEngine)

  // Destroy old viewer
  viewState.viewer?.destroy?.()

  // Initialize new viewer
  viewState.setEngine(await engine.init(newEngine))
  meshRefs.forget()
  const isStale = scriptRuns.paramChange()
  const runId = beginStream(isStale)

  // Re-run main with current params to regenerate geometry
  const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
  const mainOptions = { ...paramsCtrl.getWorkerParams(), useGpuNormals, runId, held: meshRefs.held(), supersede: true }
  let result
  try {
    result = await workerApi.jscadMain(mainOptions)
  } catch (error) {
    streamRuns.end(runId)
    if (error?.name === 'SupersededError') return
    throw error
  }
  if (isStale()) return
  handlers.entities(result)
}

paramsUI.injectParamsStyles()

// ============== File Watching ==============
// Store fileWatcher reference for explicit cleanup (fallback beforeunload also exists)
const fileWatcher = fileSystem.createFileWatcher(
  files => editor.filesChanged(files),
  () => editor.runScript()
)

// ============== Editor Initialization ==============
editor.init(
  defaultCode,
  async (script, path) => {
    const swHandler = fileSystem.getSwHandler()
    // A dropped folder's editor paths keep their leading slash in the cache.
    const cachePath = swHandler?.fileToRun ? path : currentEntry === undefined ? null : projectPathOf(path)
    if (cachePath) {
      await fileSystem.addToCacheWrapper(cachePath, script)
      await workerApi.jscadClearFileCache({ files: [cachePath], root: PROJECT_BASE })
      const open = projectPathOf(path)
      // A model of its own that the user runs becomes the project's entry, so the project reopens on it.
      const standalone = projectEntry(await fileSystem.projectFiles(), currentEntry, open) === open
      if (standalone) currentEntry = cachePath
      await recordEdit(script, cachePath, standalone ? { entry: cachePath } : {})
      buildProject(open).catch(setError)
    } else {
      // With no project opened the path is an example's URL or the editor's placeholder.
      const fullUrl = path.startsWith('http') ? path : new URL(path, appBase).toString()
      const base = new URL('./', fullUrl).toString()
      await recordEdit(script, path)
      jscadScript({ script, url: path, base })
    }
  },
  async (script, path) => {
    try {
      if (await diskProject?.save(path, script)) return
    } catch (err) {
      setError(err)
      return
    }
    const swHandler = fileSystem.getSwHandler()
    const pathArr = path.split('/')
    let fileHandle = (await swHandler?.getFile(path))?.handle
    console.log('save file', path, fileHandle)

    const saveMap = fileSystem.getSaveMap()
    if (!fileHandle) fileHandle = saveMap[path]

    // A project path is already stored by the compile that ran it, so Ctrl+S
    // must not open a Save As picker for it; a dropped file's handle still
    // writes back to disk.
    const route = saveRoute({ inProject: isRecordablePath(path), hasHandle: !!fileHandle })
    if (route === 'project') return

    if (!fileHandle) {
      const opts = {
        suggestedName: pathArr[pathArr.length - 1],
        excludeAcceptAllOption: true,
        types: [
          {
            description: 'Javascript',
            accept: { 'application/javascript': ['.js'] },
          },
        ],
      }
      fileHandle = await globalThis.showSaveFilePicker?.(opts)
    }

    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      await writable.write(script)
      await writable.close()
      fileSystem.setSaveMapEntry(path, fileHandle)
      fileHandle.lastMod = Date.now() + 500
      await recordEdit(script, path)
    } else {
      setError(new Error(missingSaveHandleMessage(path)))
    }
  },
  path => fileSystem.getSwHandler()?.getFile(path),
  confirm,
)

// Under the launcher a #/models/<entry> hash opens the model directory as the project.
const diskEntry = diskProject ? diskEntryFromHash(location.hash) : null
let hasRemoteScript = diskEntry !== null
if (diskEntry === null) {
  try {
    hasRemoteScript = await remote.init(
      async (script, url) => {
        if (!(await editor.confirmDiscard())) return
        const fullUrl = new URL(url, appBase).toString()
        editor.setSource(script, fullUrl)
        jscadScript({ script, url, base: appBase })
        welcome.dismiss()
      },
      err => {
        loadDefault = false
        setError(err)
        welcome.dismiss()
      },
    )
  } catch (e) {
    console.error(e)
  }
}

await exporter.init(workerApi, { onError: setError })

// ============== Default Script ==============
if (loadDefault && !hasRemoteScript) {
  const defaultUrl = './examples/jscad/01-two-cars.example.js'
  const fullUrl = new URL(defaultUrl, appBase).toString()
  if (await editor.confirmDiscard()) {
    editor.setSource(defaultCode, fullUrl)
    jscadScript({ script: defaultCode, url: fullUrl, base: appBase })
  }
}

// ============== Service Worker Check ==============
// Models run in the compute frame, so a failed registration costs dropped-file
// watching, not the ability to run anything. Warn, never block.
try {
  if (!fileSystem.getSwHandler()) await fileSystem.initFs(fsDeps)
  clearReloadTimestamp()
} catch (err) {
  console.warn('file service worker unavailable; dropped-file watching is off', err)
}

if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
  console.warn('file service worker not controlling this page; dropped-file watching is off')
}

// Opened only now: files cached before the service worker registers land in a memory map it no longer reads.
if (diskEntry !== null) {
  welcome.dismiss()
  await diskProject.open(diskEntry).catch(setError)
}

// ============== AI Chat ==============
// The agent loop runs in the page; each tool request is served against the
// open project's files (the file cache every run sends the frame), the
// editor, the viewer and the frame. See aiDeps.js.
const chatTools = createProjectTools({
  getProjectFiles: () => fileSystem.projectFiles(),
  writeProjectFile: async (path, content) => {
    await fileSystem.addToCacheWrapper(path, content)
    await workerApi.jscadClearFileCache({ files: [path], root: PROJECT_BASE })
  },
  removeProjectFile: async (path) => {
    await fileSystem.removeFromCache(path)
    await workerApi.jscadClearFileCache({ files: [path], root: PROJECT_BASE })
  },
  showFile: (path, content, files) => {
    editor.confirmDiscard().then((ok) => {
      if (!ok) return
      editor.setSource(content, path)
      editor.setFiles(toEditorFiles(files), { keepBuffers: true })
    })
  },
  showFiles: (files) => {
    editor.setFiles(toEditorFiles(files), { keepBuffers: true, resetMissing: true })
  },
  build: async () => {
    const outcome = await buildProject()
    if (outcome.stale) return { ok: false, error: { name: 'SupersededError', message: 'a newer run replaced this build before it finished; write or edit again to build' } }
    return projectBuilds.report()
  },
  noGeometry: projectBuilds.noGeometry,
  workerApi,
  exportModel: createExport((args) => workerApi.jscadExportData(args), { save: diskProject?.saveExport }),
  getProjectId: () => currentProjectId,
  // Stored at once, so a reload mid-turn keeps it; a failure fails the
  // write tool, so the model sees it and can retry instead of the cache
  // silently running ahead of storage.
  storeFile: (projectId, path, content) =>
    storageSession.writeThrough(projectId, path, content, { message: 'chat', version: false }),
  removeFile: (projectId, path) => storageSession.removeThrough(projectId, path),
  snapshot: (projectId) => storageSession.snapshot(projectId, { message: 'chat' }),
  getApi: getChatApi,
  loadIndex: loadApiIndex,
})

const aiDeps = {
  ...chatTools,
  view: async (input) => {
    if (input?.camera) viewState.setCamera(input.camera)
    const canvas = document.querySelector('#viewer canvas')
    const image = canvas ? canvas.toDataURL('image/png') : null
    if (!image) throw new Error('no rendered canvas to capture')
    return { ok: true, image, camera: viewState.viewer.getCamera() }
  },
  docs: createDocs(loadApiIndex, getChatApi),
  websearch: createWebSearchHandler({
    stores: createSearchStores(globalThis.localStorage),
    getProjectId: () => currentProjectId,
    getPinned: () => getWebsearchSelection().provider,
  }),
}

if (byId('ai-account')) initAccount(byId('ai-account'), {
  // The local backend persists to IndexedDB when available, so a reload keeps
  // this session's work; the unload warning applies only when it does not
  // (private mode, the compute frame), where a reload drops it. `isDirty`
  // stays false for a session that only booted the untouched default.
  hasLocalWork: () => localStore.isDirty() && !localStore.persists(),
  // The blanket web-search grant covers the live conversation; revoking it
  // clears the grant but never the stored search keys.
  onWebsearchGrant: (on) => chatControls?.setWebsearchGranted(on),
  onSignOut: async () => {
    syncHandle?.stop()
    syncHandle = null
    try { await rowboatStore?.close() } catch (err) { console.warn('rowboat close failed:', err) }
    rowboatStore = null
    rowboatStorePromise = null
    projectPanel?.setSyncStatus('')
    await projectPanel?.render()
  },
})
if (byId('ai-chat')) {
  const chatStorage = {
    readConversation: (pid) => storageSession.readConversation(pid),
    writeConversation: (pid, messages) => storageSession.writeConversation(pid, messages),
  }
  chatControls = initChat({
    container: byId('ai-chat'),
    requestTool: (name, input) => dispatchTool(name, input, aiDeps),
    getProvider: getProviderConfig,
    getApi: getChatApi,
    // Blanket web-search permission: the dialog toggle sets the default for
    // new conversations; each granted call is audit-logged to the console.
    websearchGranted: getWebsearchSelection().allow === true,
    websearchLog: (entry) => console.info('[websearch]', entry),
    websearchProvider: () => getWebsearchSelection().provider,
    storage: chatStorage,
    projectId: () => currentProjectId,
    getProjectFiles: () => fileSystem.projectFiles(),
    getBuild: projectBuilds.report,
    startTurn: chatTools.startTurn,
    endTurn: chatTools.endTurn,
  })
}
const aiDrawer = byId('ai-drawer')
const projectDrawer = byId('project-drawer')
// The two right drawers share one column, so opening either closes the other;
// otherwise the newest panel would stay behind the older one.
const setDrawer = (drawer, open) => {
  drawer?.classList.toggle('closed', !open)
  if (open) (drawer === aiDrawer ? projectDrawer : aiDrawer)?.classList.add('closed')
}
const toggleDrawer = (drawer) => setDrawer(drawer, drawer?.classList.contains('closed'))
byId('ai-toggle')?.addEventListener('click', () => toggleDrawer(aiDrawer))
byId('ai-chat-btn')?.addEventListener('click', () => {
  menu.dismiss()
  setDrawer(aiDrawer, true)
})
byId('api-help-btn')?.addEventListener('click', () => {
  menu.dismiss()
  showApiHelp({ loadIndex: loadApiIndex, getApi: getChatApi })
})

// ============== Project Panel ==============
const bootProjects = await projectManager.listAll()
if (shouldRestoreBootProject({ hasRemoteScript, diskEntry, projects: bootProjects })) {
  const bootId = pickBootProject(bootProjects)
  if (bootId) await switchProject(bootId).catch(setError)
} else if (bootProjects.length === 0) {
  currentProjectId = (await projectManager.createProject('default', { entry: 'main.js', files: defaultProjectFiles({ main: defaultCode, hierarchicalCar: hierarchicalCarCode }) })).id
}
// Boot is the baseline: everything the app itself created on load is not
// "work", so the reload warning keys off writes that came after it.
localStore.markClean()
projectPanel = initProjects({
  container: byId('project-drawer-body'),
  manager: projectManager,
  onSwitch: (id) => switchProject(id).catch(setError),
  onDropOnProject: async (id, dataTransfer) => {
    const entries = await extractEntries(dataTransfer)
    await projectManager.mergeDrop(id, entries, { readDir, readAsText }).catch(setError)
    if (id === currentProjectId) await switchProject(id).catch(setError)
    projectPanel.render()
  },
  onRestore: (id) => switchProject(id).catch(setError),
  onError: setError,
  onFlip: () => projectPanel.render(),
  readBuffer: () => ({ code: editor.getSource(), path: 'main.js' }),
  canUseRowboat: (await getRowboatStore()) !== null,
  confirm,
  onDelete: async (id) => {
    await projectManager.deleteProject(id)
    if (id === currentProjectId) {
      const next = pickBootProject(await projectManager.listAll())
      if (next) {
        await switchProject(next).catch(setError)
        await projectPanel.select(next)
      } else {
        const created = await projectManager.createProject('Untitled', { entry: 'main.js', files: defaultProjectFiles({ main: defaultCode, hierarchicalCar: hierarchicalCarCode }) })
        await switchProject(created.id).catch(setError)
        await projectPanel.select(created.id)
      }
    }
    await projectPanel.render()
  },
  onRetrySync: () => syncHandle?.syncNow(),
})
byId('project-toggle')?.addEventListener('click', () => toggleDrawer(projectDrawer))

// ============== Cleanup on Page Unload ==============
// Call destroy functions to clean up event listeners and resources
window.addEventListener('unload', () => {
  menu.destroy()
  remote.destroy()
  welcome.destroy()
  about.destroy()
  paramsUI.destroyParamsTreeView()
  editor.destroy()
  viewState.viewer?.destroy?.()
  ctrl.destroy() // Clean up OrbitControl event listeners and animation frame
  destroyFrame() // explicit terminate path: rejects pending frame requests and removes the frame
  diskProject?.stop()
  fileWatcher.cleanup() // Explicit cleanup (complements internal beforeunload fallback)
})
