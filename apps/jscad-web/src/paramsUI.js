/**
 * Parameters UI module
 * Handles parameter controller, tree view, and model updates
 */

import { createParamsTree, paramsTreeStyles, inputStyles } from '@jscadui/params-ui'
import { createParamsController } from '@jscadui/params-controller'

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

/**
 * @typedef {object} ParamsUIDeps
 * @property {JscadWorker} workerApi - Worker API
 * @property {(result: object, options?: object) => void} handleEntities - Entities handler
 * @property {(error: unknown) => void} setError - Error handler
 * @property {() => boolean} stopCurrentAnim - Stop current animation
 */

/** @type {ReturnType<typeof createParamsController>} */
let paramsCtrl

/** @type {ReturnType<typeof createParamsTree> | null} */
let paramsTreeView = null

/** @type {number|null} */
let modelUpdateTimer = null
const MODEL_UPDATE_DEBOUNCE = 50

/** @type {boolean} */
let modelUpdatePending = false

/** @type {boolean} */
let working = false

/**
 * Flag to preserve params when re-running script (e.g., modeling engine switch)
 */
let preserveParamsOnScriptRun = false

/**
 * Initialize the params controller
 * @returns {ReturnType<typeof createParamsController>}
 */
export function initParamsController() {
  paramsCtrl = createParamsController()
  return paramsCtrl
}

/**
 * Get the params controller
 * @returns {ReturnType<typeof createParamsController>}
 */
export function getParamsController() {
  return paramsCtrl
}

/**
 * Get the current params tree view
 * @returns {ReturnType<typeof createParamsTree> | null}
 */
export function getParamsTreeView() {
  return paramsTreeView
}

/**
 * Set the working state
 * @param {boolean} value
 */
export function setWorking(value) {
  working = value
}

/**
 * Get the working state
 * @returns {boolean}
 */
export function isWorking() {
  return working
}

/**
 * Set preserve params flag
 * @param {boolean} value
 */
export function setPreserveParams(value) {
  preserveParamsOnScriptRun = value
}

/**
 * Get and reset preserve params flag
 * @returns {boolean}
 */
export function consumePreserveParams() {
  const value = preserveParamsOnScriptRun
  preserveParamsOnScriptRun = false
  return value
}

/**
 * Schedule a model update (debounced)
 * @param {() => Promise<void>} runModelUpdate
 */
export function scheduleModelUpdate(runModelUpdate) {
  if (modelUpdateTimer) clearTimeout(modelUpdateTimer)
  modelUpdatePending = true
  modelUpdateTimer = setTimeout(() => {
    modelUpdateTimer = null
    runModelUpdate()
  }, MODEL_UPDATE_DEBOUNCE)
}

/**
 * Check if model update is pending
 * @returns {boolean}
 */
export function isModelUpdatePending() {
  return modelUpdatePending
}

/**
 * Set model update pending state
 * @param {boolean} value
 */
export function setModelUpdatePending(value) {
  modelUpdatePending = value
}

/**
 * Clear model update timer
 */
export function clearModelUpdateTimer() {
  if (modelUpdateTimer) {
    clearTimeout(modelUpdateTimer)
    modelUpdateTimer = null
  }
}

/**
 * Run the model and update 3D view
 * @param {ParamsUIDeps} deps
 */
export async function runModelUpdate(deps) {
  const { workerApi, handleEntities, setError, stopCurrentAnim } = deps

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
      const state = paramsCtrl.getState()
      paramsTreeView?.update({
        tree: result.proxyState.tree,
        values: state.params,
        types: structureChanged ? result.proxyState.types : undefined,
        classes: structureChanged ? result.proxyState.classes : undefined,
        codeClasses: structureChanged ? state.codeClasses : undefined
      })
    }

    handleEntities(result, {})
  } catch (err) {
    setError(err)
    console.error('Model update failed:', err)
  } finally {
    working = false
    if (modelUpdatePending) runModelUpdate(deps)
  }
}

/**
 * Handle parameter change from tree view
 * @param {string} paramPath
 * @param {unknown} value
 * @param {() => void} onScheduleUpdate
 */
export function handleTreeParamChange(paramPath, value, onScheduleUpdate) {
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

  onScheduleUpdate()
}

/**
 * Handle class change from tree view
 * @param {string} partPath
 * @param {string} newClass
 * @param {'unlink'|'move_group'|'join'|'join_group'} mode
 * @param {ParamsUIDeps} deps
 */
export async function handleTreeClassChange(partPath, newClass, mode, deps) {
  paramsCtrl.setClass(partPath, newClass, mode)

  // Class changes run immediately (no debounce)
  clearModelUpdateTimer()
  await runModelUpdate(deps)
}

/**
 * Create the params tree UI
 * @param {object} options
 * @param {HTMLElement} options.target
 * @param {object} options.proxyState
 * @param {object} options.state
 * @param {(paramPath: string, value: unknown) => void} options.onChange
 * @param {(partPath: string, newClass: string, mode: string) => void} options.onClassChange
 */
export function createParamsTreeUI({ target, proxyState, state, onChange, onClassChange }) {
  paramsTreeView = createParamsTree({
    target,
    tree: proxyState.tree,
    values: state.params,
    types: proxyState.types,
    classes: proxyState.classes,
    codeClasses: state.codeClasses,
    onChange,
    onClassChange,
    showHidden: false
  })
  return paramsTreeView
}

/**
 * Destroy the current params tree view
 */
export function destroyParamsTreeView() {
  if (paramsTreeView) {
    paramsTreeView.destroy()
    paramsTreeView = null
  }
}

/**
 * Inject params tree styles into document
 */
export function injectParamsStyles() {
  const style = document.createElement('style')
  style.textContent = paramsTreeStyles + inputStyles
  document.head.appendChild(style)
}

/**
 * Build params header controls
 * @param {HTMLElement} paramsHeader
 * @returns {{ showHiddenCheckbox: HTMLInputElement }}
 */
export function buildParamsHeader(paramsHeader) {
  paramsHeader.innerHTML = ''

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

  return { showHiddenCheckbox }
}
