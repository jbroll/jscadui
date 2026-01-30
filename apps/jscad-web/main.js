// Global error handlers - catch unhandled errors and rejections
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

import {
  addToCache,
  analyzeProject,
  clearCache,
  clearFs,
  extractEntries,
  fileDropped,
  getFile,
  getFileContent,
  registerServiceWorker,
} from '@jscadui/fs-provider'
import { Gizmo } from '@jscadui/html-gizmo'
import { OrbitControl, OrbitState } from '@jscadui/orbit'
import { boundingBox } from '@jscadui/format-common'
import { genParams, getParams } from '@jscadui/params'
import { createParamsTree, paramsTreeStyles, inputStyles } from '@jscadui/params-ui'
import { createParamsController } from '@jscadui/params-controller'
import { messageProxy } from '@jscadui/postmessage'

import defaultCode from './examples/two-cars.example.js'
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

/**
 * @typedef {import('@jscadui/worker').UserParameters} UserParameters
 */


/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = id => /** @type {HTMLElement} */(document.getElementById(id))

/** @typedef {import('@jscadui/worker').JscadWorker} JscadWorker*/

// Use origin + '/' as base to ensure proper URL resolution
// document.baseURI might include a path (e.g., /index.html) which breaks nested require resolution
const appBase = location.origin + '/'
let currentBase = appBase

/**
 * @param {string} path
 * @return {string}
 */
const toUrl = path => new URL(path, appBase).toString()

const viewState = new ViewState()
viewState.onRequireReRender = () => paramChangeCallback(ctrl.params)


const gizmo = new Gizmo()
byId('layout').append(gizmo)

/** @type {(v:unknown,skipUndefined?:boolean)=>void} */
let setParamValues

/** @type {(status:"running" | "")=>void} */
let setAnimStatus

// load default model unless another model was already loaded
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

/** @type {import('@jscadui/fs-provider').SwHandler} */
let sw

async function resetFileRefs() {
  editor.setFiles([])
  saveMap = {}
  if (sw) {
    delete sw.fileToRun
    await clearFs(sw)
  }
}

async function initFs() {
  /**
   * @param {string} path
   * @param {import('@jscadui/fs-provider').SwHandler} sw
   */
  const getFileWrapper = (path, sw) => {
    const file = getFileContent(path, sw)
    // notify editor of active files
    file.then(() => editor.setFiles(sw.filesToCheck)).catch(err => {
      console.error('Failed to get file content:', path, err)
    })
    return file
  }
  const scope = document.location.pathname
  try {
    sw = await registerServiceWorker(`bundle.fs-serviceworker.js?prefix=${scope}swfs/`, getFileWrapper, {
      scope,
      prefix: scope + 'swfs/',
    })
  } catch (e) {
    const lastReload = localStorage.getItem('lastReload')
    if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
      localStorage.setItem('lastReload', Date.now().toString())
      //location.reload()
    }
  }
  sw.defProjectName = 'jscad'
  sw.onfileschange = files => {
    if (files.includes('/package.json')) {
      reloadProject()
    } else {
      workerApi.jscadClearFileCache({ files, root: sw.base })
      editor.filesChanged(files)
      if (sw.fileToRun) jscadScript({ url: sw.fileToRun, base: sw.base })
    }
  }
  sw.getFile = path => getFile(path, sw)
}
const dropModal = byId('dropModal')

/** @type {number | NodeJS.Timeout | undefined} */
let showDropTimer

/**@param {boolean} show */
const showDrop = show => {
  clearTimeout(showDropTimer)
  dropModal.style.display = show ? 'initial' : 'none'
}

document.body.addEventListener('drop', async ev => {
  try {
    ev.preventDefault()
    if (ev.dataTransfer === null) return
    const files = await extractEntries(ev.dataTransfer)
    if (!files.length) return
    await resetFileRefs()
    if (!sw) await initFs()
    showDrop(false)
    await fileDropped(sw, files)

    reloadProject()
  } catch (error) {
    setError(error)
    console.error(error)
  }
})

async function reloadProject() {
  workerApi.jscadClearTempCache()
  clearCache(sw.cache)
  saveMap = {}
  sw.filesToCheck = []
  let { alias, script } = await analyzeProject(sw)
  exporter.exportConfig.projectName = sw.projectName
  if (alias.length) {
    workerApi.jscadInit({ alias })
  }
  const url = sw.fileToRun
  // inject jscad v1 shim, and also inject changed script to cache
  // so worker and editor have the same code
  if (sw.fileToRun?.endsWith('.jscad')) {
    script = addV1Shim(script)
    addToCache(sw.cache, sw.fileToRun, script)
  }
  jscadScript({ url, base: sw.base })
  editor.setSource(script, url)
  editor.setFiles(sw.filesToCheck)
}

document.body.addEventListener("dragover", ev => {
  ev.preventDefault()
  showDrop(true)
})


const dragEndOrLeave = () => {
  clearTimeout(showDropTimer)
  showDropTimer = setTimeout(() => {
    showDrop(false)
  }, 300)
}

document.body.addEventListener("dragend", dragEndOrLeave);
document.body.addEventListener("dragleave", dragEndOrLeave);

const statsContent = byId('stats-content')
const progress = /** @type {HTMLProgressElement} */ (byId('progress'))

/**
 * @param {number} [value]
 */
const onProgress = (value) => {
  if (value == undefined) {
    progress.removeAttribute('value')
  } else {
    progress.value = value
  }
}

const worker = new Worker('./build/bundle.worker.js')

// Handle worker errors that would otherwise be silent
worker.onerror = (event) => {
  console.error('Worker error:', event.message, event.filename, event.lineno)
  setError(new Error(`Worker error: ${event.message}`))
}

/**
 * Format a number with K/M suffix for large values
 * @param {number} n
 * @returns {string}
 */
function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/**
 * Format milliseconds for display
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
  if (ms == null) return '—'
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's'
  return ms.toFixed(1) + 'ms'
}

/**
 * Update the pipeline stats display
 * @param {object} stats
 * @param {number} [stats.treeTime] - Operation tree building time (Manifold lazy ops)
 * @param {number} [stats.execTime] - Manifold evaluation time (forcing lazy ops)
 * @param {number} [stats.convTime] - Geometry conversion time (getMesh + format)
 * @param {number} [stats.renderTime] - Render time
 * @param {number} [stats.triangles] - Total triangle count
 * @param {number} [stats.vertices] - Total vertex count
 */
function updatePipelineStats({ treeTime, execTime, convTime, renderTime, triangles, vertices }) {
  const rows = []

  // Timing section - show tree time only if > 0.5ms (Manifold lazy eval)
  if (treeTime != null && treeTime > 0.5) {
    rows.push(`<div class="stat-row"><span class="stat-label">Tree</span><span class="stat-value">${formatMs(treeTime)}</span></div>`)
  }
  if (execTime != null) {
    rows.push(`<div class="stat-row"><span class="stat-label">Exec</span><span class="stat-value">${formatMs(execTime)}</span></div>`)
  }
  if (convTime != null) {
    rows.push(`<div class="stat-row"><span class="stat-label">Conv</span><span class="stat-value">${formatMs(convTime)}</span></div>`)
  }
  if (renderTime != null) {
    rows.push(`<div class="stat-row"><span class="stat-label">Render</span><span class="stat-value">${formatMs(renderTime)}</span></div>`)
  }

  // Separator and geometry section
  if ((triangles != null || vertices != null) && rows.length > 0) {
    rows.push('<div class="stat-separator"></div>')
  }
  if (triangles != null) {
    rows.push(`<div class="stat-row"><span class="stat-label">Triangles</span><span class="stat-value">${formatCount(triangles)}</span></div>`)
  }
  if (vertices != null) {
    rows.push(`<div class="stat-row"><span class="stat-label">Vertices</span><span class="stat-value">${formatCount(vertices)}</span></div>`)
  }

  statsContent.innerHTML = rows.join('')
}

/**
 * Count triangles and vertices from entities
 * @param {Array<{vertices?: ArrayLike<number>, indices?: ArrayLike<number>}>} entities
 * @returns {{triangles: number, vertices: number}}
 */
function countGeometry(entities) {
  let triangles = 0
  let vertices = 0
  for (const e of entities) {
    if (e.indices) triangles += e.indices.length / 3
    if (e.vertices) vertices += e.vertices.length / 3
  }
  return { triangles, vertices
  }
}

const handlers = {
  /**
   * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} options1
   * @param {{skipLog?:boolean }} options2
   */
  entities: ({ entities, treeTime, execTime, convTime }, { skipLog } = {}) => {
    if (!(entities instanceof Array)) entities = [entities]

    // Track render time
    const renderStart = performance.now()
    viewState.setModel(entities)
    const renderTime = performance.now() - renderStart

    if(viewState.zoomToFit){
      const {min,max} = boundingBox(entities)
      console.warn('min', min, 'max', max, viewState.viewer.getCamera())
      const { fov, aspect } = viewState.viewer.getCamera()
      ctrl.fit(min,max, fov,aspect,1.2)
    }
    if (!skipLog) console.log('tree:', treeTime?.toFixed(2), ', exec:', execTime?.toFixed(2), ', conv:', convTime?.toFixed(2), ', render:', renderTime?.toFixed(2), entities)
    setError(undefined)
    onProgress(undefined)

    // Update pipeline stats
    const { triangles, vertices } = countGeometry(entities)
    updatePipelineStats({
      treeTime,
      execTime,
      convTime,
      renderTime,
      triangles,
      vertices
    })
  },
  onProgress,
}

const workerApi = /** @type {JscadWorker} */ (messageProxy(worker, handlers, { onJobCount: trackJobs }))

/**@type {NodeJS.Timeout} */
let firstJobTimer

/**
 * @param {number} jobs
 */
function trackJobs(jobs) {
  if (jobs === 1) {
    // do not show progress for fast renders
    clearTimeout(firstJobTimer)
    firstJobTimer = setTimeout(() => {
      onProgress()
      progress.style.display = 'block'
    }, 300)
  }
  if (jobs === 0) {
    clearTimeout(firstJobTimer)
    progress.style.display = 'none'
  }
}

// ============== Params Controller ==============
const paramsCtrl = createParamsController()

/** @type {ReturnType<typeof createParamsTree> | null} */
let paramsTreeView = null

/**
 * Flag to preserve params when re-running script (e.g., modeling engine switch)
 * When true, jscadScript won't reset params - just re-runs with existing values
 */
let preserveParamsOnScriptRun = false

/** @type {number|null} */
let modelUpdateTimer = null
const MODEL_UPDATE_DEBOUNCE = 50

/** @type {boolean} */
let modelUpdatePending = false

/**
 * Handle parameter change from tree view
 * @param {string} paramPath
 * @param {unknown} value
 */
const handleTreeParamChange = (paramPath, value) => {
  const linkedPaths = paramsCtrl.setParam(paramPath, value)
  if (linkedPaths.length === 0) return

  // Update linked inputs in DOM directly (don't re-render whole tree)
  const inputs = document.querySelectorAll('[data-param-path]')
  for (const input of inputs) {
    const path = input.dataset.paramPath
    if (linkedPaths.includes(path) && path !== paramPath) {
      // Use updateValue method if available (for complex inputs like sliders, colors)
      if (typeof input.updateValue === 'function') {
        input.updateValue(value)
      } else {
        input.value = String(value)
      }
    }
  }

  scheduleModelUpdate()
}

/**
 * Schedule a model update (debounced)
 */
const scheduleModelUpdate = () => {
  if (modelUpdateTimer) clearTimeout(modelUpdateTimer)
  modelUpdatePending = true
  modelUpdateTimer = setTimeout(() => {
    modelUpdateTimer = null
    runModelUpdate()
  }, MODEL_UPDATE_DEBOUNCE)
}

/**
 * Run the model and update 3D view
 */
const runModelUpdate = async () => {
  if (working) {
    modelUpdatePending = true
    return
  }

  modelUpdatePending = false
  stopCurrentAnim()
  working = true

  try {
    const result = await workerApi.jscadMain(paramsCtrl.getWorkerParams())

    if (result.proxyState) {
      const oldState = paramsCtrl.proxyState
      paramsCtrl.updateProxyState(result.proxyState)

      const structureChanged = (
        JSON.stringify(oldState?.types) !== JSON.stringify(result.proxyState.types) ||
        JSON.stringify(oldState?.classes) !== JSON.stringify(result.proxyState.classes)
      )

      // Always update tree to refresh constrained param defaults (calculated values)
      // The tree contains param.default which may change when model re-runs
      const state = paramsCtrl.getState()
      paramsTreeView?.update({
        tree: result.proxyState.tree,
        values: state.params,
        types: structureChanged ? result.proxyState.types : undefined,
        classes: structureChanged ? result.proxyState.classes : undefined,
        codeClasses: structureChanged ? state.codeClasses : undefined
      })
    }

    handlers.entities(result, {})
  } catch (err) {
    setError(err)
    console.error('Model update failed:', err)
  } finally {
    working = false
    if (modelUpdatePending) runModelUpdate()
  }
}

/**
 * Handle class change from tree view
 * @param {string} partPath
 * @param {string} newClass
 * @param {'unlink'|'move_group'|'join'|'join_group'} mode
 */
const handleTreeClassChange = async (partPath, newClass, mode) => {
  paramsCtrl.setClass(partPath, newClass, mode)

  // Class changes run immediately (no debounce)
  if (modelUpdateTimer) {
    clearTimeout(modelUpdateTimer)
    modelUpdateTimer = null
  }
  await runModelUpdate()
}

/** @param {{script?:string,url?:string,base?:string,root?:string}} options*/
const jscadScript = async ({ script, url = './jscad.model.js', base = currentBase, root }) => {
  currentBase = base
  loadDefault = false

  // Save params if preserving across engine switch
  const savedParams = preserveParamsOnScriptRun ? { ...paramsCtrl.params } : null
  const savedUserInteracted = preserveParamsOnScriptRun ? new Set(paramsCtrl.userInteracted) : null
  preserveParamsOnScriptRun = false

  // Reset controller and UI
  paramsCtrl.reset()
  if (paramsTreeView) {
    paramsTreeView.destroy()
    paramsTreeView = null
  }

  try {
    // Query renderer capability for GPU normals support
    const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
    const result = await workerApi.jscadScript({ script, url, base, root, useGpuNormals })

    if (result.proxyState && useParamsProxy) {
      paramsCtrl.initFromResult(result)

      // Setup UI
      const paramsHeader = byId('paramsHeader')
      const paramsDiv = byId('paramsDiv')
      paramsHeader.innerHTML = ''
      paramsDiv.innerHTML = ''

      // Controls header
      const controls = document.createElement('div')
      controls.className = 'params-tree-controls'
      controls.style.cssText = 'display:flex;gap:12px;align-items:center;padding:4px 8px;border-bottom:1px solid #ddd;'

      const showHiddenLabel = document.createElement('label')
      showHiddenLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;'
      const showHiddenCheckbox = document.createElement('input')
      showHiddenCheckbox.type = 'checkbox'
      showHiddenCheckbox.id = 'showHiddenParams'
      showHiddenLabel.appendChild(showHiddenCheckbox)
      showHiddenLabel.appendChild(document.createTextNode('Show hidden'))
      controls.appendChild(showHiddenLabel)

      const expandBtn = document.createElement('button')
      expandBtn.textContent = 'Expand'
      expandBtn.style.cssText = 'font-size:11px;padding:2px 6px;cursor:pointer;'
      expandBtn.onclick = () => paramsTreeView?.expandAll()
      controls.appendChild(expandBtn)

      const collapseBtn = document.createElement('button')
      collapseBtn.textContent = 'Collapse'
      collapseBtn.style.cssText = 'font-size:11px;padding:2px 6px;cursor:pointer;'
      collapseBtn.onclick = () => paramsTreeView?.collapseAll()
      controls.appendChild(collapseBtn)

      paramsHeader.appendChild(controls)

      // Tree container
      const treeContainer = document.createElement('div')
      treeContainer.id = 'paramsTreeContainer'
      paramsDiv.appendChild(treeContainer)

      const state = paramsCtrl.getState()
      paramsTreeView = createParamsTree({
        target: treeContainer,
        tree: result.proxyState.tree,
        values: state.params,
        types: result.proxyState.types,
        classes: result.proxyState.classes,
        codeClasses: state.codeClasses,
        onChange: handleTreeParamChange,
        onClassChange: handleTreeClassChange,
        showHidden: false
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
        return // Skip the default entities call below
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

/**
 * Get the modeling bundle URL based on the selected engine.
 * @returns {string}
 */
const getModelingBundle = () => {
  const engine = viewState.modelingEngine
  if (engine === 'manifold') {
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
  '@jscad/modeling-core': toUrl('./build/bundle.jscad_modeling.js'), // Internal dependency for manifold
  '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
  '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
  '@jscadui/params-core': toUrl('./build/bundle.params_core.js'),
})

const useParamsProxy = true

// Initialize render engine first so we can query its capabilities
viewState.setEngine(await engine.init(viewState.renderEngine))

await workerApi.jscadInit({ bundles: getBundles(), useParamsProxy })

// Set up engine change handler (now that jscadScript and getBundles are defined)
viewState.onModelingEngineChange = async (newEngine) => {
  console.log('Switching modeling engine to:', newEngine)

  // Set flag to preserve params across script re-run
  preserveParamsOnScriptRun = Object.keys(paramsCtrl.params).length > 0

  // Reinitialize worker with new bundles
  await workerApi.jscadInit({ bundles: getBundles(), useParamsProxy })

  // Re-run script (required - modeling engine changed, need fresh require() of new bundle)
  editor.runScript()
}

viewState.onRenderEngineChange = async (newEngine) => {
  console.log('Switching render engine to:', newEngine)

  // Destroy old viewer
  viewState.viewer?.destroy?.()

  // Initialize new viewer
  viewState.setEngine(await engine.init(newEngine))

  // Re-run main with current params to regenerate geometry for new renderer
  // (different renderers need different geometry formats - GPU vs CPU normals)
  // No need to update proxyState - only geometry format changes, not params
  const useGpuNormals = viewState.viewer?.supportsGpuNormals ?? false
  const mainOptions = useParamsProxy
    ? { ...paramsCtrl.getWorkerParams(), useGpuNormals }
    : { params: lastRunParams, useGpuNormals }
  const result = await workerApi.jscadMain(mainOptions)

  // Just update the 3D view - params UI stays as-is since params didn't change
  handlers.entities(result)
}

if (useParamsProxy) {
  const style = document.createElement('style')
  style.textContent = paramsTreeStyles + inputStyles
  document.head.appendChild(style)
}

/** @type {boolean} */
let working

/** @type {UserParameters | null} */
let lastParams
/** @type {UserParameters} */
let lastRunParams

/**
 * @param {UserParameters} params
 * @param {string} [source]
 */
const paramChangeCallback = async (params, source) => {
  if (source == 'group') return

  // Track changed params in proxy mode
  if (useParamsProxy && lastRunParams) {
    for (const key in params) {
      if (params[key] !== lastRunParams[key]) {
        paramsCtrl.userInteracted.add(key)
      }
    }
  }

  stopCurrentAnim()
  if (!working) {
    lastParams = null
  } else {
    lastParams = params
    return
  }
  working = true
  let result
  try {
    const mainOptions = useParamsProxy
      ? paramsCtrl.getWorkerParams()
      : { params }
    result = await workerApi.jscadMain(mainOptions)
    lastRunParams = params
  } finally {
    working = false
  }
  handlers.entities(result, {})
  if (lastParams && lastParams != params) paramChangeCallback(lastParams)
}

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

  const handleEntities = (result, paramValues, times) => {
    lastRunParams = paramValues
    setParamValues(times || {}, true)
    handlers.entities(result, { skipLog: true })
  }

  const handleEnd = () => stopCurrentAnim()

  currentAnim = new AnimRunner(workerApi, { handleEntities, handleEnd })
  currentAnim.start(def, value, getParams(byId('paramsDiv')))
}

const pauseAnimCallback = async (def, value) => {
  stopCurrentAnim()
}

/** @type {Object.<string,FileSystemFileHandle>} */
let saveMap = {}
setInterval(async () => {
  for (const p in saveMap) {
    const handle = saveMap[p]
    const file = await handle.getFile()
    if (file.lastModified > handle.lastMod) {
      handle.lastMod = file.lastModified
      await editor.filesChanged([file])
      editor.runScript();
    }
  }
}, 500)

editor.init(
  defaultCode,
  async (script, path) => {
    if (sw && sw.fileToRun) {
      await addToCache(sw.cache, path, script)
      await workerApi.jscadClearFileCache({ files: [path], root: sw.base })
      if (sw.fileToRun) jscadScript({ url: sw.fileToRun, base: sw.base })
    } else {
      // Compute base directory from the path URL
      // path may be absolute URL or relative - use appBase as fallback
      const fullUrl = path.startsWith('http') ? path : new URL(path, appBase).toString()
      const base = new URL('./', fullUrl).toString()
      jscadScript({ script, url: path, base })
    }
  },
  async (script, path) => {
    const pathArr = path.split('/')
    let fileHandle = (await sw?.getFile(path))?.handle
    console.log('save file', path, fileHandle)
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
      saveMap[path] = fileHandle
      fileHandle.lastMod = Date.now() + 500
    }
  },
  path => sw?.getFile(path),
)
menu.init()
welcome.init()
about.init()
let hasRemoteScript
try {
  hasRemoteScript = await remote.init(
    (script, url) => {
      const fullUrl = new URL(url, appBase).toString()
      editor.setSource(script, fullUrl)
      jscadScript({ script, url, base: appBase })  // Explicitly pass appBase to avoid currentBase pollution
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

/* uncomment to test fake file tree for running scripts

loadDefault = false
async function setFileTree(sw, files){
  clearCache(sw.cache)
  files.forEach(f=>addToCache(sw.cache, f.path, f.fileContent))
}

const virtualTree = [
  {
      "filename": "index.js",
      "path": "/index.js",
      "fileContent": "const {subtract} = require('@jscad/modeling').booleans; \n\nfunction main(){\n  const childShape = require('/component/childShape.js');\n  const childShape2 = require('/childShape2.js');\n  return subtract(childShape.main(),childShape2.main())\n}\n\nmodule.exports= {main}",
  },
  {
      "path": "/component/childShape.js",
      "filename": "childShape.js",
      "fileContent": "const {cube} = require('@jscad/modeling').primitives; \n function main(){ return cube({size:5})}\n module.exports= {main}",
  },
  {
      "path": "/childShape2.js",
      "filename": "childShape2.js",
      "fileContent": "const {sphere} = require('@jscad/modeling').primitives; \n function main(){ return sphere({radius:3})}\n module.exports= {main}",
  },
];
if (!sw) await initFs()
setFileTree(sw, virtualTree)
jscadScript({ url: '/index.js', base: sw.base })
editor.setSource(virtualTree[0].fileContent, '/index.js')
// */

if (loadDefault && !hasRemoteScript) {
  const defaultUrl = './examples/two-cars.example.js'
  const fullUrl = new URL(defaultUrl, appBase).toString()
  editor.setSource(defaultCode, fullUrl)
  jscadScript({ script: defaultCode, url: defaultUrl, base: appBase })
}

try {
  if(!sw) await initFs()
} catch (err) {
  setError(err)
}

if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
  const lastReload = localStorage.getItem('lastReload')
  if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
    setError('cannot start service worker, reloading')
    localStorage.setItem('lastReload', Date.now().toString())
  } else {
    console.error('cannot start service worker, reload required')
  }
  setError('cannot start service worker, reload required')
}
