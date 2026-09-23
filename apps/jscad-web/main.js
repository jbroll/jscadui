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
import { genParams, getParams } from '@jscadui/params'

// Local modules
import defaultCode from './examples/jscad/01-two-cars.example.js'
import { addV1Shim } from './src/addV1Shim.js'
import * as editor from './src/editor.js'
import * as engine from './src/engine.js'
import * as exporter from './src/exporter.js'
import * as menu from './src/menu.js'
import * as remote from './src/remote.js'
import { setError } from './src/error.js'
import { ViewState } from './src/viewState.js'
import { AnimRunner } from './src/animRunner.js'
import * as welcome from './src/welcome.js'
import * as about from './src/about.js'
import { showTrustedSourcesDialog, trustedSourcesStyles } from './src/trustedSourcesUI.js'
import { showDemoBrowser, demoBrowserStyles } from './src/demoBrowser.js'

// Extracted modules
import { updatePipelineStats, countGeometry, createProgressHandler } from './src/stats.js'
import { capGeometry, DEFAULT_CAPS } from './src/caps.js'
import { createEvaluate } from './src/aiEvaluate.js'
// Leaf imports, not ./src/storage/index.js: the index re-exports schema.js,
// whose zod 4 types the root TS 4.9 gate cannot parse (see root tsconfig).
import { createLocalStorage } from './src/storage/local.js'
import { assembleFileMap } from './src/storage/map.js'
import { createProjectManager } from './src/storage/projects.js'
import { createSession } from './src/storage/session.js'
import { initProjects } from './src/projects.js'
import { extractEntries, readAsText, readDir } from '@jscadui/fs-provider'
import { createFrame, createJobTracker } from './src/frameSetup.js'
import { collectProjectFiles, replaceProjectFiles } from './src/projectFiles.js'
import { createScriptRuns, sendScript } from './src/scriptRuns.js'
import { PROJECT_BASE } from './src_frame/fileMap.js'
import * as fileSystem from './src/fileSystem.js'
import * as paramsUI from './src/paramsUI.js'
import { clearReloadTimestamp } from './src/reloadDetection.js'
import { installStudioBridge } from './src/studioBridge.js'
import { handleToolRequest } from './src/aiBridge.js'
import { initChat } from './src/aiChat.js'
import { initAccount, getProviderConfig, getSession } from './src/aiAccount.js'

/**
 * @typedef {import('@jscadui/worker').UserParameters} UserParameters
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

/** @type {(v:unknown,skipUndefined?:boolean)=>void} */
let setParamValues

/** @type {(status:"running" | "")=>void} */
let setAnimStatus

// Load default model unless another model was already loaded
let loadDefault = true

// ============== Menu & Welcome ==============
// Wired before the frame boot below: none of the chrome needs the frame, and a
// click landing during those awaits would be dropped rather than queued.
menu.init({
  onBrowseDemos: () => showDemoBrowser({
    baseUrl: new URL('./examples/', appBase).toString(),
    onLoad: (script, url) => {
      editor.setSource(script, url)
      jscadScript({ script, url, base: new URL('./', new URL(url, appBase)).toString(), root: appBase })
      welcome.dismiss()
    },
  })
})
welcome.init()
about.init()

// Trusted Sources dialog
const trustedSourcesBtn = byId('trusted-sources-btn')
if (trustedSourcesBtn) {
  trustedSourcesBtn.addEventListener('click', showTrustedSourcesDialog)
}

// Inject dialog styles
const trustedStyles = document.createElement('style')
trustedStyles.textContent = trustedSourcesStyles + '\n' + demoBrowserStyles
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

// ============== Params Controller ==============
const paramsCtrl = paramsUI.initParamsController()
const useParamsProxy = true

/** @type {UserParameters} */
let lastRunParams

// ============== Compute Frame Setup ==============

/**
 * Handle entities from worker
 * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
 * @param {{skipLog?:boolean }} options
 */
const handleEntities = (result, { skipLog } = {}) => {
  const { entities: rawEntities, treeTime, execTime, convTime } = result
  const entities = rawEntities instanceof Array ? rawEntities : [rawEntities]

  // Refuse to draw past the caps before any allocation for rendering.
  try {
    capGeometry(entities, DEFAULT_CAPS)
  } catch (error) {
    setError(error)
    onProgress(undefined)
    return
  }

  // Track render time
  const renderStart = performance.now()
  viewState.setModel(entities)
  const renderTime = performance.now() - renderStart

  if (viewState.zoomToFit) {
    const { min, max } = boundingBox(entities)
    const { fov, aspect } = viewState.viewer.getCamera()
    ctrl.fit(min, max, fov, aspect, 1 / 0.6)  // model fills ~60% of viewport
  }

  if (!skipLog) {
    console.log('tree:', treeTime?.toFixed(2), ', exec:', execTime?.toFixed(2), ', conv:', convTime?.toFixed(2), ', render:', renderTime?.toFixed(2), entities)
  }

  // Read by the render sweep, which must tell an empty model from a render
  const { triangles, vertices } = countGeometry(entities)
  document.documentElement.dataset.vertices = String(vertices)

  setError(undefined)
  onProgress(undefined)

  updatePipelineStats(statsContent, { treeTime, execTime, convTime, renderTime, triangles, vertices })
}

const trackJobs = createJobTracker(progress, onProgress)

// Every model — the editor's and the agent's — runs in the sandboxed frame.
// Its opaque origin means no cookies, no storage and no same-origin fetch.
/* global __FRAME_ORIGIN__ */
const { frameEl, workerApi, handlers } = await createFrame({
  onError: setError,
  onEntities: handleEntities,
  onJobCount: trackJobs,
  // No onTerminated re-init: frameSetup replays the inits itself, and an init
  // sent on every restart loops forever when the init is what timed out.
  runOrigin: __FRAME_ORIGIN__,
})

// Twice the old agent cap: the heaviest examples in the corpus finish well
// inside it, and a runaway model still dies rather than wedging the frame.
// The render sweep raises it: there the point is whether a model is correct,
// not whether it is quick, and the cap is only there to stop a hang.
const DEFAULT_EDITOR_TIMEOUT_MS = 120_000
const EDITOR_TIMEOUT_MS = (() => {
  try {
    const stored = Number(localStorage.getItem('engine.modelTimeoutMs'))
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_EDITOR_TIMEOUT_MS
  } catch {
    return DEFAULT_EDITOR_TIMEOUT_MS
  }
})()

// The frame names its own bundles; the app names only the engine.
const initFrame = () =>
  workerApi
    .jscadInit({ engine: viewState.modelingEngine, useParamsProxy, timeoutMs: EDITOR_TIMEOUT_MS })
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
  onFilesChange: () => reloadProject().catch(err => setError(err)), // M9 fix: Handle floating promise
  setEditorFiles: files => editor.setFiles(files),
  onFilesChanged: files => editor.filesChanged(files),
  setError,
  onAliasFound: alias => workerApi.jscadInit({ alias }),
  onScriptReady: (script, url) => {
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

// Version/hash record for every editor compile and writeModel save against
// the live project; the session routes by the manager's per-project mode.
const localStore = createLocalStorage()
let rowboatStore = null
const projectManager = createProjectManager({ local: localStore, getRowboat: () => rowboatStore })
const storageSession = createSession({ local: localStore, getRowboat: () => rowboatStore, getBackend: (projectId) => projectManager.peekMode(projectId) })

const recordEdit = (script, path) =>
  storageSession.writeThrough(currentProjectId, path, script, { message: 'edit', entry: path }).catch((err) => console.warn('storage write failed:', err))

let currentProjectId = 'default'

const toEditorFiles = (files) =>
  Object.entries(files).map(([path, content]) =>
    Object.assign(new File([content], path.split('/').pop()), { fullPath: `/${path}` }),
  )

const switchProject = async (id) => {
  const { project, files } = await projectManager.readForSwitch(id)
  currentProjectId = id
  workerApi.jscadClearTempCache()
  await replaceProjectFiles(fileSystem, files)
  editor.setFiles(toEditorFiles(files))
  editor.setSource(files[project.entry] ?? '', project.entry)
  jscadScript({ script: files[project.entry] ?? '', ...projectUrls(project.entry) })
}

// Lazy rowboat backend: built once a session exists, so anonymous users stay
// local-only and never load the rowboat client. Dynamic imports keep the
// TS 4.9 gate green (see above) and the rowboat bundle out of anonymous loads.
let rowboatStorePromise = null

const fetchSyncToken = async () => {
  try {
    const res = await fetch('/api/sync-token', { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body?.token ? body : null
  } catch {
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

const getActiveStore = async () => (await getRowboatStore()) ?? localStore

// Interval table sync while signed in; anonymous users never reach it.
const initSyncLoop = async () => {
  const store = await getRowboatStore()
  if (!store) return
  const { createSyncLoop } = await import('./src/storage/sync.js')
  const loop = createSyncLoop({
    storage: store,
    getToken: async () => (await fetchSyncToken())?.token ?? null,
    onError: (err) => console.warn('rowboat sync failed:', err),
  })
  loop.start()
}

initSyncLoop()

fileSystem.setupDragDrop(dropModal, async (dataTransfer, target) => {
  const row = target?.closest?.('[data-project-id]')
  if (row) {
    const entries = await extractEntries(dataTransfer)
    await projectManager.mergeDrop(row.dataset.projectId, entries, { readDir, readAsText }).catch(setError)
    if (row.dataset.projectId === currentProjectId) await switchProject(currentProjectId).catch(setError)
    return
  }
  await fileSystem.handleFileDrop(dataTransfer, fsDeps)
  const entries = await extractEntries(dataTransfer)
  if (entries.length === 1 && entries[0].isDirectory) {
    const created = await projectManager.createFromDrop(entries, { readDir, readAsText }).catch(setError)
    if (created) await switchProject(created.id).catch(setError)
  }
})

// ============== Animation ==============
/** @type {AnimRunner | null} */
let currentAnim

function stopCurrentAnim() {
  if (!currentAnim) return false
  currentAnim.pause()
  currentAnim = null
  setAnimStatus('')
  return true
}

// ============== Studio Bridge ==============
installStudioBridge({
  paramsCtrl,
  getParams: () => paramsCtrl.getState().params,
  runModel: () => paramsUI.runModelUpdate({
    workerApi,
    handleEntities: handlers.entities,
    setError,
    stopCurrentAnim,
  }),
})

/**
 * @param {Object} def
 * @param {string | number} value
 */
const startAnimCallback = async (def, value) => {
  if (stopCurrentAnim()) return
  setAnimStatus('running')

  const handleAnimEntities = (result, paramValues, times) => {
    lastRunParams = paramValues
    setParamValues(times || {}, true)
    handlers.entities(result, { skipLog: true })
  }

  const handleEnd = () => stopCurrentAnim()

  currentAnim = new AnimRunner(workerApi, { handleEntities: handleAnimEntities, handleEnd })
  currentAnim.start(def, value, getParams(byId('paramsDiv')))
}

const pauseAnimCallback = async (_def, _value) => {
  stopCurrentAnim()
}

// ============== Param Change Handling ==============
/**
 * I7 note: This stores only the most recent pending params, not a queue.
 * This is intentional - when dragging a slider rapidly, we only want to
 * process the final value where the user stopped, not every intermediate value.
 * This prevents excessive re-renders and provides better UX.
 * @type {UserParameters | null}
 */
let lastParams

const scriptRuns = createScriptRuns()

/**
 * @param {UserParameters} params
 * @param {string} [source]
 */
const paramChangeCallback = async (params, source) => {
  if (source === 'group') return

  // Track changed params in proxy mode
  if (useParamsProxy && lastRunParams) {
    for (const key in params) {
      if (params[key] !== lastRunParams[key]) {
        paramsCtrl.userInteracted.add(key)
      }
    }
  }

  stopCurrentAnim()
  if (paramsUI.isWorking()) {
    // I7 note: Overwrites previous pending - intentionally keeps only the latest
    lastParams = params
    return
  }
  lastParams = null
  paramsUI.setWorking(true)
  const isStale = scriptRuns.paramChange()

  let result
  let pendingParams = null
  try {
    const mainOptions = useParamsProxy
      ? paramsCtrl.getWorkerParams()
      : { params }
    result = await workerApi.jscadMain(mainOptions)
    if (isStale()) return
    lastRunParams = params
  } finally {
    // Capture pending params atomically before releasing lock
    pendingParams = lastParams
    lastParams = null
    paramsUI.setWorking(false)
  }
  handlers.entities(result, {})
  if (pendingParams && pendingParams !== params) paramChangeCallback(pendingParams)
}

viewState.onRequireReRender = () => paramChangeCallback(ctrl.params)

// ============== Script Loading ==============

/** @param {{script?:string,url?:string,base?:string,root?:string}} options*/
const jscadScript = async ({ script, url = './jscad.model.js', base = currentBase, root }) => {
  const isStale = scriptRuns.load()
  currentBase = base
  loadDefault = false
  document.documentElement.dataset.render = 'running'
  delete document.documentElement.dataset.vertices

  // Save params if preserving across engine switch
  const shouldPreserve = paramsUI.consumePreserveParams()
  const savedParams = shouldPreserve ? { ...paramsCtrl.params } : null
  const savedUserInteracted = shouldPreserve ? new Set(paramsCtrl.userInteracted) : null

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
    const files = await collectProjectFiles(fileSystem.getSwHandler())
    if (isStale()) return
    const result = await sendScript(workerApi, files, { script, url, base, root, useGpuNormals })
    if (isStale()) return

    if (result.proxyState && useParamsProxy) {
      paramsCtrl.initFromResult(result)

      // Setup UI
      const paramsHeader = byId('paramsHeader')
      const paramsDiv = byId('paramsDiv')
      paramsDiv.innerHTML = ''

      const { showHiddenCheckbox } = paramsUI.buildParamsHeader(paramsHeader)

      // Tree container
      const treeContainer = document.createElement('div')
      treeContainer.id = 'paramsTreeContainer'
      paramsDiv.appendChild(treeContainer)

      const state = paramsCtrl.getState()
      const paramsTreeView = paramsUI.createParamsTreeUI({
        target: treeContainer,
        proxyState: result.proxyState,
        state,
        onChange: (paramPath, value) => {
          paramsUI.handleTreeParamChange(paramPath, value, () => {
            paramsUI.scheduleModelUpdate(() => paramsUI.runModelUpdate({
              workerApi,
              handleEntities: handlers.entities,
              setError,
              stopCurrentAnim
            }))
          })
        },
        onClassChange: (partPath, newClass, mode) => {
          paramsUI.handleTreeClassChange(partPath, newClass, mode, {
            workerApi,
            handleEntities: handlers.entities,
            setError,
            stopCurrentAnim
          })
        }
      })

      showHiddenCheckbox.onchange = () => {
        paramsTreeView?.setShowHidden(showHiddenCheckbox.checked)
      }

      setParamValues = (name, value) => {
        paramsCtrl.params[name] = value
        paramsTreeView?.update({ values: paramsCtrl.params })
      }
      setAnimStatus = () => {}
      lastRunParams = state.params

      // Restore params if we were preserving across engine switch
      if (savedParams) {
        Object.assign(paramsCtrl.params, savedParams)
        savedUserInteracted.forEach(p => paramsCtrl.userInteracted.add(p))
        paramsTreeView?.update({ values: paramsCtrl.params })
        // Re-run model with restored params
        const restoreResult = await workerApi.jscadMain(paramsCtrl.getWorkerParams())
        if (isStale()) return
        handlers.entities(restoreResult)
        return
      }
    } else {
      // Traditional flat params form
      const tmp = genParams({ target: byId('paramsDiv'), params: result.def || [], callback: paramChangeCallback, pauseAnim: pauseAnimCallback, startAnim: startAnimCallback })
      setParamValues = tmp.setValue
      setAnimStatus = tmp.animStatus
      lastRunParams = result.params
    }

    handlers.entities(result)
    if (result.def) {
      result.def.find(def => {
        if (def.type === "slider" && def.fps && def.autostart) {
          startAnimCallback(def, lastRunParams[def.name] || 0)
          return true
        }
      })
    }
  } catch (err) {
    if (!isStale()) setError(err)
  }
}

// ============== Engine Initialization ==============

// Initialize render engine first so we can query its capabilities
viewState.setEngine(await engine.init(viewState.renderEngine))

await initFrame()

// Set up engine change handler
viewState.onModelingEngineChange = async (newEngine) => {
  console.log('Switching modeling engine to:', newEngine)

  // Set flag to preserve params across script re-run
  paramsUI.setPreserveParams(Object.keys(paramsCtrl.params).length > 0)

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
  const isStale = scriptRuns.paramChange()

  // Re-run main with current params to regenerate geometry
  const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
  const mainOptions = useParamsProxy
    ? { ...paramsCtrl.getWorkerParams(), useGpuNormals }
    : { params: lastRunParams, useGpuNormals }
  const result = await workerApi.jscadMain(mainOptions)
  if (isStale()) return
  handlers.entities(result)
}

if (useParamsProxy) {
  paramsUI.injectParamsStyles()
}

// ============== File Watching ==============
// I8 fix: Store fileWatcher reference for explicit cleanup (fallback beforeunload also exists)
const fileWatcher = fileSystem.createFileWatcher(
  files => editor.filesChanged(files),
  () => editor.runScript()
)

// ============== Editor Initialization ==============
editor.init(
  defaultCode,
  async (script, path) => {
    const swHandler = fileSystem.getSwHandler()
    if (swHandler && swHandler.fileToRun) {
      await fileSystem.addToCacheWrapper(path, script)
      await workerApi.jscadClearFileCache({ files: [path], root: PROJECT_BASE })
      await recordEdit(script, path)
      if (swHandler.fileToRun) jscadScript(projectUrls(swHandler.fileToRun))
    } else {
      const fullUrl = path.startsWith('http') ? path : new URL(path, appBase).toString()
      const base = new URL('./', fullUrl).toString()
      await recordEdit(script, path)
      jscadScript({ script, url: path, base })
    }
  },
  async (script, path) => {
    const swHandler = fileSystem.getSwHandler()
    const pathArr = path.split('/')
    let fileHandle = (await swHandler?.getFile(path))?.handle
    console.log('save file', path, fileHandle)

    const saveMap = fileSystem.getSaveMap()
    if (!fileHandle) fileHandle = saveMap[path]

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
    }
  },
  path => fileSystem.getSwHandler()?.getFile(path),
)

let hasRemoteScript
try {
  hasRemoteScript = await remote.init(
    (script, url) => {
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

await exporter.init(workerApi)

// ============== Default Script ==============
if (loadDefault && !hasRemoteScript) {
  const defaultUrl = './examples/jscad/01-two-cars.example.js'
  const fullUrl = new URL(defaultUrl, appBase).toString()
  editor.setSource(defaultCode, fullUrl)
  jscadScript({ script: defaultCode, url: defaultUrl, base: appBase })
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

// ============== AI Chat ==============
// The agent loop runs server-side; the browser executes each tool request
// against the local worker, viewer and editor, then POSTs the result back.
const toBase64 = (buffers) => {
  let binary = ''
  for (const chunk of buffers) {
    const bytes = new Uint8Array(chunk)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const aiDeps = {
  evaluate: createEvaluate(workerApi, handleEntities),
  setParams: async (values) => {
    Object.assign(paramsCtrl.params, values)
    for (const key of Object.keys(values)) paramsCtrl.userInteracted.add(key)
    await paramChangeCallback(paramsCtrl.params)
    return { updated: Object.keys(values) }
  },
  measure: async (options) => await workerApi.jscadMeasure({ options }),
  check: async (input) => await workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} }),
  exportModel: async ({ format }) => {
    const { data = [] } = await workerApi.jscadExportData({ format })
    const chunks = (data instanceof Array ? data : [data]).filter((v) => v instanceof ArrayBuffer)
    const size = chunks.reduce((n, v) => n + v.byteLength, 0)
    return { format, size, data: toBase64(chunks) }
  },
  view: async (input) => {
    if (input?.camera) viewState.setCamera(input.camera)
    const canvas = document.querySelector('#viewer canvas')
    const image = canvas ? canvas.toDataURL('image/png') : null
    if (!image) throw new Error('no rendered canvas to capture')
    return { ok: true, image, camera: viewState.viewer.getCamera() }
  },
  save: async (source, entry = './jscad.model.js') => {
    editor.setSource(source, entry)
    await recordEdit(source, entry)
    return { ok: true, entry }
  },
}

if (byId('ai-account')) initAccount(byId('ai-account'))
if (byId('ai-chat')) {
  const chatStorage = {
    readConversation: (pid) => getActiveStore().then((store) => store.readConversation(pid)),
    writeConversation: (pid, messages) => getActiveStore().then((store) => store.writeConversation(pid, messages)),
  }
  initChat({
    container: byId('ai-chat'),
    requestTool: (name, input) => handleToolRequest(name, input, aiDeps),
    getProvider: getProviderConfig,
    storage: chatStorage,
    projectId: () => currentProjectId,
  })
}
const aiDrawer = byId('ai-drawer')
const toggleAi = () => aiDrawer?.classList.toggle('closed')
byId('ai-toggle')?.addEventListener('click', toggleAi)
byId('ai-chat-btn')?.addEventListener('click', () => {
  aiDrawer?.classList.remove('closed')
})

// ============== Project Panel ==============
if ((await projectManager.listAll()).length === 0) {
  await projectManager.createProject('default', { entry: 'main.js', files: { 'main.js': defaultCode } })
}
const projectPanel = initProjects({
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
})
const projectDrawer = byId('project-drawer')
byId('project-toggle')?.addEventListener('click', () => projectDrawer?.classList.toggle('closed'))

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
  ctrl.destroy() // M5 fix: Clean up OrbitControl event listeners and animation frame
  frameEl.remove() // tears down the frame and its worker on page unload
  fileWatcher.cleanup() // I8 fix: Explicit cleanup (complements internal beforeunload fallback)
})
