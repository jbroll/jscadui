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
import { createParamsTree, paramsTreeStyles, getLinkedParamPaths, getLinkedParts } from '@jscadui/params-proxy'
import { messageProxy } from '@jscadui/postmessage'

import defaultCode from './examples/jscad.example.js'
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

/**
 * @typedef {import('@jscadui/worker').UserParameters} UserParameters
 */


/** 
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = id => /** @type {HTMLElement} */(document.getElementById(id))

/** @typedef {import('@jscadui/worker').JscadWorker} JscadWorker*/

const appBase = document.baseURI
let currentBase = appBase

/**
 * @param {string} path
 * @return {string}
 */
const toUrl = path => new URL(path, appBase).toString()

const viewState = new ViewState()
viewState.onRequireReRender = () => paramChangeCallback(lastRunParams)

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
  let scope = document.location.pathname
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
  let url = sw.fileToRun
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

/**
 * @param {number} [value]
 * @param {string} [note]
 */
const onProgress = (value, note) => {
  if (value == undefined) {
    progress.removeAttribute('value')
  } else {
    progress.value = value
  }
  progressText.innerText = note ?? ''
}

const worker = new Worker('./build/bundle.worker.js')

// Handle worker errors that would otherwise be silent
worker.onerror = (event) => {
  console.error('Worker error:', event.message, event.filename, event.lineno)
  setError(new Error(`Worker error: ${event.message}`))
}

const handlers = {
  /**
   * @param {{entities:unknown | Array<unknown>,mainTime:number,convertTime:number}} options1 
   * @param {{skipLog?:boolean }} options2
   */
  entities: ({ entities, mainTime, convertTime }, { skipLog } = {}) => {
    if (!(entities instanceof Array)) entities = [entities]
    viewState.setModel(entities)
    if(viewState.zoomToFit){
      let {min,max} = boundingBox(entities)
      console.warn('min', min, 'max', max, viewState.viewer.getCamera())
      let { fov, aspect } = viewState.viewer.getCamera()
      ctrl.fit(min,max, fov,aspect,1.2)
    }
    if (!skipLog) console.log('Main execution:', mainTime?.toFixed(2), ', jscad mesh -> gl:', convertTime?.toFixed(2), entities)
    setError(undefined)
    onProgress(undefined, mainTime?.toFixed(2) + ' ms')
  },
  onProgress,
}

const workerApi = /** @type {JscadWorker} */ (messageProxy(worker, handlers, { onJobCount: trackJobs }))

const progress = /** @type {HTMLProgressElement} */ (byId('progress').querySelector('progress'))
const progressText = byId('progressText')

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

/** @type {Set<string>} - Tracks which params the user has interacted with (for proxy mode) */
let userInteractedPaths = new Set()

/** @type {ReturnType<typeof createParamsTree> | null} - Tree view instance for proxy mode */
let paramsTreeView = null
/** @type {Object} - Current proxy state (types, classes) for class linking */
let currentProxyState = null
/** @type {Object} - Original code-defined classes from worker (before user modifications) */
let codeDefinedClasses = null
/** @type {Object.<string, Object>} - Original code-defined values per class (className -> {paramName: value}) */
let codeDefinedClassValues = {}

/** @type {number|null} - Debounce timer for model updates */
let modelUpdateTimer = null
/** @type {number} - Debounce delay in ms for model updates */
const MODEL_UPDATE_DEBOUNCE = 50
/** @type {boolean} - Flag to track if a model update is pending */
let modelUpdatePending = false

/**
 * Handle parameter change from tree view
 *
 * Architecture (unidirectional data flow):
 * 1. User action → update state (lastRunParams) synchronously
 * 2. Update UI immediately (re-render tree with new state)
 * 3. Schedule model update (debounced, async)
 * 4. Model completes → update 3D view (UI already shows correct values)
 *
 * @param {string} paramPath
 * @param {unknown} value
 */
const handleTreeParamChange = (paramPath, value) => {
  if (!currentProxyState) return

  // Skip if value hasn't actually changed (prevents duplicate oninput events)
  if (lastRunParams[paramPath] === value) {
    return
  }

  // Step 1: Update state synchronously (including linked params)
  const typesMap = new Map(Object.entries(currentProxyState.types || {}))
  const classesMap = new Map(Object.entries(currentProxyState.classes || {}))
  const linkedPaths = getLinkedParamPaths(typesMap, classesMap, paramPath)

  for (const path of linkedPaths) {
    lastRunParams[path] = value
    userInteractedPaths.add(path)
  }

  // Step 2: Update linked inputs in DOM directly (don't re-render, just update values)
  // This avoids destroying the input the user is interacting with
  const inputs = document.querySelectorAll('[data-param-path]')
  for (const input of inputs) {
    const path = input.dataset.paramPath
    if (linkedPaths.includes(path) && path !== paramPath) {
      // Update linked input (not the one being edited)
      input.value = String(value)
    }
  }

  // Step 3: Schedule model update (debounced)
  scheduleModelUpdate()
}

/**
 * Schedule a model update (debounced to batch rapid changes)
 */
const scheduleModelUpdate = () => {
  if (modelUpdateTimer) {
    clearTimeout(modelUpdateTimer)
  }
  modelUpdatePending = true
  modelUpdateTimer = setTimeout(() => {
    modelUpdateTimer = null
    runModelUpdate()
  }, MODEL_UPDATE_DEBOUNCE)
}

/**
 * Run the model and update 3D view
 * UI is NOT updated here - it was already updated synchronously
 */
const runModelUpdate = async () => {
  if (working) {
    // Already running, schedule retry
    modelUpdatePending = true
    return
  }

  modelUpdatePending = false
  stopCurrentAnim()
  working = true

  try {
    const result = await workerApi.jscadMain({
      params: { ...lastRunParams },
      userInteractedPaths: [...userInteractedPaths]
    })

    // Update proxy state if structure changed
    if (result.proxyState) {
      // Build effective classes map - merge code defaults with user overrides
      const effectiveClasses = { ...result.proxyState.classes }
      for (const path of userInteractedPaths) {
        if (path.endsWith('._class')) {
          const partPath = path.slice(0, -7) // Remove '._class'
          effectiveClasses[partPath] = lastRunParams[path]
        }
      }

      const structureChanged = (
        JSON.stringify(currentProxyState?.types) !== JSON.stringify(result.proxyState.types) ||
        JSON.stringify(currentProxyState?.classes) !== JSON.stringify(effectiveClasses)
      )

      // Update the proxyState with effective classes
      result.proxyState.classes = effectiveClasses
      currentProxyState = result.proxyState

      // Only re-render tree if structure changed (new params discovered, classes changed)
      if (structureChanged) {
        paramsTreeView?.update({
          tree: result.proxyState.tree,
          values: lastRunParams,
          types: result.proxyState.types,
          classes: effectiveClasses,
          codeClasses: codeDefinedClasses // Keep original code-defined classes for dropdown options
        })
      }
    }

    // Update 3D view
    handlers.entities(result, {})
  } finally {
    working = false

    // If another update was requested while we were working, run it now
    if (modelUpdatePending) {
      runModelUpdate()
    }
  }
}

/**
 * Get all param paths for a part (e.g., 'front.left' -> ['front.left.radius', 'front.left.width', ...])
 * @param {string} partPath
 * @returns {string[]}
 */
const getParamPathsForPart = (partPath) => {
  const prefix = partPath + '.'
  return Object.keys(lastRunParams).filter(p => p.startsWith(prefix) && !p.substring(prefix.length).includes('.'))
}

/**
 * Apply stored code-defined class values to a part
 * Used when joining an empty class that has stored original values
 * @param {string} className - The class name to get values from
 * @param {string} targetPartPath - The part to apply values to
 */
const applyStoredClassValues = (className, targetPartPath) => {
  const storedValues = codeDefinedClassValues[className]
  if (!storedValues) return

  const targetPrefix = targetPartPath + '.'

  // Get params that exist on target
  const targetParams = new Set()
  for (const key of Object.keys(lastRunParams)) {
    if (key.startsWith(targetPrefix)) {
      const paramName = key.substring(targetPrefix.length)
      if (!paramName.includes('.') && paramName !== '_class' && !paramName.startsWith('_')) {
        targetParams.add(paramName)
      }
    }
  }

  // Apply stored values for params that exist on target
  for (const [paramName, value] of Object.entries(storedValues)) {
    if (targetParams.has(paramName) && value !== undefined && value !== null) {
      const targetKey = targetPrefix + paramName
      lastRunParams[targetKey] = value
      userInteractedPaths.add(targetKey)
    }
  }
}

/**
 * Copy param values from one part to another
 * @param {string} sourcePartPath
 * @param {string} targetPartPath
 */
const copyPartValues = (sourcePartPath, targetPartPath) => {
  const sourcePrefix = sourcePartPath + '.'
  const targetPrefix = targetPartPath + '.'

  // First, collect all params that exist for both source and target
  const sourceParams = {}
  const targetParams = new Set()

  for (const key of Object.keys(lastRunParams)) {
    if (key.startsWith(sourcePrefix)) {
      const paramName = key.substring(sourcePrefix.length)
      // Only copy leaf params (not nested parts), skip _class and hidden params
      if (!paramName.includes('.') && paramName !== '_class' && !paramName.startsWith('_')) {
        sourceParams[paramName] = lastRunParams[key]
      }
    }
    if (key.startsWith(targetPrefix)) {
      const paramName = key.substring(targetPrefix.length)
      if (!paramName.includes('.') && paramName !== '_class' && !paramName.startsWith('_')) {
        targetParams.add(paramName)
      }
    }
  }

  // Only copy params that exist in both source and target, and have valid values
  for (const paramName of Object.keys(sourceParams)) {
    if (targetParams.has(paramName)) {
      const value = sourceParams[paramName]
      // Skip undefined/null values
      if (value !== undefined && value !== null) {
        const targetKey = targetPrefix + paramName
        lastRunParams[targetKey] = value
        userInteractedPaths.add(targetKey)
      }
    }
  }
}

/**
 * Handle class change from tree view
 * @param {string} partPath - The part whose class is being changed
 * @param {string} newClass - The new class name
 * @param {'unlink'|'move_group'|'join'|'join_group'} mode - How to change the class
 */
const handleTreeClassChange = async (partPath, newClass, mode) => {
  if (!currentProxyState) return

  const typesMap = new Map(Object.entries(currentProxyState.types || {}))

  // Build effective classes map - merge code defaults with user overrides
  const classesMap = new Map(Object.entries(currentProxyState.classes || {}))
  for (const path of userInteractedPaths) {
    if (path.endsWith('._class')) {
      const pPath = path.slice(0, -7) // Remove '._class'
      classesMap.set(pPath, lastRunParams[path])
    }
  }

  // Get parts in current class (for group operations)
  const currentClassParts = getLinkedParts(typesMap, classesMap, partPath)

  // Get parts already in the target class (for join operations)
  // Find a part that already has the target class
  let targetClassParts = []
  for (const [p, c] of classesMap) {
    if (c === newClass && typesMap.get(p) === typesMap.get(partPath)) {
      targetClassParts = getLinkedParts(typesMap, classesMap, p)
      break
    }
  }
  const sourcePartForValues = targetClassParts[0] // Part to copy values from

  switch (mode) {
    case 'unlink':
      // Move just this part to a new class (keeps its current values)
      lastRunParams[`${partPath}._class`] = newClass
      userInteractedPaths.add(`${partPath}._class`)
      break

    case 'move_group':
      // Move all parts in current class to a new class (keeps current values)
      for (const p of currentClassParts) {
        lastRunParams[`${p}._class`] = newClass
        userInteractedPaths.add(`${p}._class`)
      }
      break

    case 'join':
      // Move just this part to an existing class (adopt target's values)
      lastRunParams[`${partPath}._class`] = newClass
      userInteractedPaths.add(`${partPath}._class`)
      if (sourcePartForValues && sourcePartForValues !== partPath) {
        // Copy values from existing part in the target class
        copyPartValues(sourcePartForValues, partPath)
      } else if (!sourcePartForValues) {
        // Target class is empty - restore from stored code-defined values
        applyStoredClassValues(newClass, partPath)
      }
      break

    case 'join_group':
      // Move all parts in current class to an existing class (adopt target's values)
      for (const p of currentClassParts) {
        lastRunParams[`${p}._class`] = newClass
        userInteractedPaths.add(`${p}._class`)
        if (sourcePartForValues && sourcePartForValues !== p) {
          // Copy values from existing part in the target class
          copyPartValues(sourcePartForValues, p)
        } else if (!sourcePartForValues) {
          // Target class is empty - restore from stored code-defined values
          applyStoredClassValues(newClass, p)
        }
      }
      break
  }

  // For class changes, run model immediately (no debounce) since structure changes
  // Clear any pending debounced update
  if (modelUpdateTimer) {
    clearTimeout(modelUpdateTimer)
    modelUpdateTimer = null
  }
  await runModelUpdate()
}

/** @param {{script?:string,url?:string,base?:string,root?:string}} options*/
const jscadScript = async ({ script, url = './jscad.model.js', base = currentBase, root }) => {
  currentBase = base
  loadDefault = false // don't load default model if something else was loaded
  // Reset user interactions when loading a new script
  userInteractedPaths = new Set()
  // Destroy previous tree view if any
  if (paramsTreeView) {
    paramsTreeView.destroy()
    paramsTreeView = null
  }
  currentProxyState = null
  codeDefinedClasses = null
  codeDefinedClassValues = {}
  try {
    const result = await workerApi.jscadScript({ script, url, base, root })

    // Use tree view in proxy mode, flat genParams otherwise
    if (result.proxyState && useParamsProxy) {
      console.log('Params Proxy Mode - discovered params:', result.proxyState.discovered.length)
      currentProxyState = result.proxyState
      // Store the original code-defined classes from worker
      codeDefinedClasses = { ...result.proxyState.classes }

      // Store original values for each class (for restoring when joining empty classes)
      codeDefinedClassValues = {}
      for (const [partPath, className] of Object.entries(result.proxyState.classes)) {
        if (!codeDefinedClassValues[className]) {
          // Capture values from the first part we see in this class
          codeDefinedClassValues[className] = {}
          const prefix = partPath + '.'
          for (const [key, value] of Object.entries(result.params || {})) {
            if (key.startsWith(prefix)) {
              const paramName = key.substring(prefix.length)
              // Only store leaf params (not nested), skip _class and hidden params
              if (!paramName.includes('.') && paramName !== '_class' && !paramName.startsWith('_')) {
                codeDefinedClassValues[className][paramName] = value
              }
            }
          }
        }
      }
      console.log('Code-defined class values:', codeDefinedClassValues)

      // Clear header and paramsDiv
      const paramsHeader = byId('paramsHeader')
      const paramsDiv = byId('paramsDiv')
      paramsHeader.innerHTML = ''
      paramsDiv.innerHTML = ''

      // Add controls to header (outside scroll region)
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

      // Expand/Collapse buttons
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

      // Tree container inside paramsDiv (scrollable)
      const treeContainer = document.createElement('div')
      treeContainer.id = 'paramsTreeContainer'
      paramsDiv.appendChild(treeContainer)

      // Create tree view
      paramsTreeView = createParamsTree({
        target: treeContainer,
        tree: result.proxyState.tree,
        values: result.params || {},
        types: result.proxyState.types,
        classes: result.proxyState.classes,
        codeClasses: codeDefinedClasses, // Original code-defined classes (for dropdown options)
        onChange: handleTreeParamChange,
        onClassChange: handleTreeClassChange,
        showHidden: false
      })

      // Wire up show hidden toggle
      showHiddenCheckbox.onchange = () => {
        paramsTreeView?.setShowHidden(showHiddenCheckbox.checked)
      }

      // No animation support in tree view yet
      setParamValues = (name, value) => {
        // Update single value and re-render tree
        lastRunParams[name] = value
        paramsTreeView?.update({ values: lastRunParams })
      }
      setAnimStatus = () => {}
      lastRunParams = result.params
    } else {
      // Traditional flat params form
      let tmp = genParams({ target: byId('paramsDiv'), params: result.def || [], callback: paramChangeCallback, pauseAnim: pauseAnimCallback, startAnim: startAnimCallback })
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

const bundles = {
  // local bundled alias for common libs.
  '@jscad/modeling': toUrl('./build/bundle.jscad_modeling.js'),
  '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
  '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
}

// Enable useParamsProxy for hierarchical parameter discovery
// Check URL param: ?proxy=1 to enable proxy mode
const useParamsProxy = new URLSearchParams(location.search).has('proxy')
await workerApi.jscadInit({ bundles, useParamsProxy })

// Inject tree view styles if in proxy mode
if (useParamsProxy) {
  const style = document.createElement('style')
  style.textContent = paramsTreeStyles
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
 * @returns
 */
const paramChangeCallback = async (params, source) => {
  if (source == 'group') {
    // TODO make sure when saving param state is implemented
    // this change is saved, but skip param re-render
    return
  }

  // Track which params changed (for proxy mode)
  if (useParamsProxy && lastRunParams) {
    for (const key in params) {
      if (params[key] !== lastRunParams[key]) {
        userInteractedPaths.add(key)
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
    // Pass userInteractedPaths in proxy mode
    const mainOptions = useParamsProxy
      ? { params, userInteractedPaths: [...userInteractedPaths] }
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

/**
 * @typedef {object} AnimationDefinition
 * @prop {string} type
 */

function stopCurrentAnim() {
  if (!currentAnim) return false
  currentAnim.pause()
  currentAnim = null
  setAnimStatus('')
  return true
}

/**
 * @param {AnimationDefinition} def 
 * @param {string | number} value //TODO check why this is sometimes a string
 */
const startAnimCallback = async (def, value) => {
  if (stopCurrentAnim()) return
  setAnimStatus('running')

  /**
   * @param {import('@jscadui/worker').ScriptResponse} result
   * @param {UserParameters} paramValues 
   * @param {object | undefined} times 
   */
  const handleEntities = (result, paramValues, times) => {
    lastRunParams = paramValues
    setParamValues(times || {}, true)
    handlers.entities(result, { skipLog: true })
  }

  const handleEnd = () => stopCurrentAnim()

  currentAnim = new AnimRunner(workerApi, { handleEntities, handleEnd })
  currentAnim.start(def, value, getParams(byId('paramsDiv')))
}

/**
 * @param {AnimationDefinition} def 
 * @param {string} value
 */
const pauseAnimCallback = async (def, value) => {
  stopCurrentAnim()
}

// Initialize three engine
viewState.setEngine(await engine.init())

/** @type {Object.<string,FileSystemFileHandle>} */
let saveMap = {}
setInterval(async () => {
  for (let p in saveMap) {
    let handle = saveMap[p]
    let file = await handle.getFile()
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
      // imported script will be also cached by require/import implementation
      // it is expected if multiple files require same file/module that first time it is loaded
      // but for others resolved module is returned
      // if not cleared by calling jscadClearFileCache, require will not try to reload the file
      await workerApi.jscadClearFileCache({ files: [path], root: sw.base })
      if (sw.fileToRun) jscadScript({ url: sw.fileToRun, base: sw.base })
    } else {
      jscadScript({ script })
    }
  },
  async (script, path) => {
    let pathArr = path.split('/')
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
let hasRemoteScript
try {
  hasRemoteScript = await remote.init(
    (script, url) => {
      // run remote script
      url = new URL(url, appBase).toString()
      editor.setSource(script, url)
      jscadScript({ script, base: url })
      welcome.dismiss()
    },
    err => {
      // show remote script error
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
  jscadScript({ script: defaultCode })
}

try {
  if(!sw) await initFs()
} catch (err) {
  setError(err)
}

if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
  // service workers are disabled on hard-refresh, so need to reload.
  // to prevent a reload loop, don't reload again within 3 seconds.
  const lastReload = localStorage.getItem('lastReload')
  if (lastReload === null || Date.now() - parseInt(lastReload) > 3000) {
    setError('cannot start service worker, reloading')
    localStorage.setItem('lastReload', Date.now().toString())
    //location.reload()
  } else {
    console.error('cannot start service worker, reload required')
  }
  setError('cannot start service worker, reload required')
}
