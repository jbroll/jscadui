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
import { createWorker, createJobTracker } from './src/workerSetup.js'
import * as fileSystem from './src/fileSystem.js'
import * as paramsUI from './src/paramsUI.js'
import { shouldAllowReload, clearReloadTimestamp } from './src/reloadDetection.js'

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

/**
 * @param {string} path
 * @return {string}
 */
const toUrl = path => new URL(path, appBase).toString()

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

// ============== Worker Setup ==============

/**
 * Handle entities from worker
 * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
 * @param {{skipLog?:boolean }} options
 */
const handleEntities = (result, { skipLog } = {}) => {
  const { entities: rawEntities, treeTime, execTime, convTime } = result
  const entities = rawEntities instanceof Array ? rawEntities : [rawEntities]

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

  setError(undefined)
  onProgress(undefined)

  // Update pipeline stats
  const { triangles, vertices } = countGeometry(entities)
  updatePipelineStats(statsContent, { treeTime, execTime, convTime, renderTime, triangles, vertices })
}

const trackJobs = createJobTracker(progress, onProgress)

// I9 fix: Keep worker reference for termination on unload
const { worker, workerApi, handlers } = createWorker({
  onError: setError,
  onProgress,
  onEntities: handleEntities,
  onJobCount: trackJobs
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
    const sw = fileSystem.getSwHandler()
    jscadScript({ url, base: sw?.base || appBase })
    editor.setSource(script, url)
  },
  setProjectName: name => { exporter.exportConfig.projectName = name },
  addV1Shim,
  clearFileCache: (files, root) => workerApi.jscadClearFileCache({ files, root })
}

async function reloadProject() {
  workerApi.jscadClearTempCache()
  await fileSystem.reloadProject(fsDeps)
}

fileSystem.setupDragDrop(dropModal, async (dataTransfer) => {
  await fileSystem.handleFileDrop(dataTransfer, fsDeps)
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

  let result
  let pendingParams = null
  try {
    const mainOptions = useParamsProxy
      ? paramsCtrl.getWorkerParams()
      : { params }
    result = await workerApi.jscadMain(mainOptions)
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

/**
 * Get the modeling bundle URL based on the selected engine.
 * @returns {string}
 */
const getModelingBundle = () => {
  const engineName = viewState.modelingEngine
  if (engineName === 'manifold') {
    return toUrl('./build/bundle.manifold_modeling.js')
  }
  return toUrl('./build/bundle.jscad_modeling.js')
}

/**
 * Get the bundles configuration for the worker.
 * @returns {Record<string, string>}
 */
const getBundles = () => ({
  '@jscad/modeling': getModelingBundle(),
  '@jscad/modeling-for-manifold': toUrl('./build/bundle.jscad_modeling.js'),
  '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
  '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
  '@jscadui/params-core': toUrl('./build/bundle.params_core.js'),
})

/** @param {{script?:string,url?:string,base?:string,root?:string}} options*/
const jscadScript = async ({ script, url = './jscad.model.js', base = currentBase, root }) => {
  currentBase = base
  loadDefault = false

  // Save params if preserving across engine switch
  const shouldPreserve = paramsUI.consumePreserveParams()
  const savedParams = shouldPreserve ? { ...paramsCtrl.params } : null
  const savedUserInteracted = shouldPreserve ? new Set(paramsCtrl.userInteracted) : null

  // Reset controller and UI
  paramsCtrl.reset()
  paramsUI.destroyParamsTreeView()

  try {
    // Query renderer capability for GPU normals support
    const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
    const result = await workerApi.jscadScript({ script, url, base, root, useGpuNormals })

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
    setError(err)
  }
}

// ============== Engine Initialization ==============

// Initialize render engine first so we can query its capabilities
viewState.setEngine(await engine.init(viewState.renderEngine))

await workerApi.jscadInit({ bundles: getBundles(), useParamsProxy })

// Set up engine change handler
viewState.onModelingEngineChange = async (newEngine) => {
  console.log('Switching modeling engine to:', newEngine)

  // Set flag to preserve params across script re-run
  paramsUI.setPreserveParams(Object.keys(paramsCtrl.params).length > 0)

  // Reinitialize worker with new bundles
  await workerApi.jscadInit({ bundles: getBundles(), useParamsProxy })

  // Re-run script
  editor.runScript()
}

viewState.onRenderEngineChange = async (newEngine) => {
  console.log('Switching render engine to:', newEngine)

  // Destroy old viewer
  viewState.viewer?.destroy?.()

  // Initialize new viewer
  viewState.setEngine(await engine.init(newEngine))

  // Re-run main with current params to regenerate geometry
  const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
  const mainOptions = useParamsProxy
    ? { ...paramsCtrl.getWorkerParams(), useGpuNormals }
    : { params: lastRunParams, useGpuNormals }
  const result = await workerApi.jscadMain(mainOptions)
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
      await workerApi.jscadClearFileCache({ files: [path], root: swHandler.base })
      if (swHandler.fileToRun) jscadScript({ url: swHandler.fileToRun, base: swHandler.base })
    } else {
      const fullUrl = path.startsWith('http') ? path : new URL(path, appBase).toString()
      const base = new URL('./', fullUrl).toString()
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
    }
  },
  path => fileSystem.getSwHandler()?.getFile(path),
)

// ============== Menu & Welcome ==============
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
try {
  if (!fileSystem.getSwHandler()) await fileSystem.initFs(fsDeps)
  // C2 fix: Clear reload retry count on successful initialization
  clearReloadTimestamp()
} catch (err) {
  setError(err)
}

if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
  if (shouldAllowReload()) {
    setError('cannot start service worker, reloading')
  } else {
    setError('cannot start service worker, reload required')
  }
}

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
  worker.terminate() // I9 fix: Terminate worker on page unload
  fileWatcher.cleanup() // I8 fix: Explicit cleanup (complements internal beforeunload fallback)
})
