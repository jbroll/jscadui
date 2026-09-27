/**
 * Parameters UI module
 * Handles parameter controller, tree view, and model updates
 */

import { createParamsTree, paramsTreeStyles, inputStyles } from '@jscadui/params-ui'
import { createParamsController } from '@jscadui/params-controller'
import { ABANDON_AFTER_MS } from '../src_frame/frameHost.js'

/**
 * Efficiently compare two Maps or Map-like objects for equality.
 * Avoids JSON.stringify overhead for structural comparison.
 * @param {Map|Object|undefined} a
 * @param {Map|Object|undefined} b
 * @returns {boolean} True if equal
 */
const mapsEqual = (a, b) => {
  if (a === b) return true
  if (!a || !b) return a === b

  // Handle Maps or plain objects
  const aIsMap = a instanceof Map
  const bIsMap = b instanceof Map
  const aEntries = aIsMap ? Array.from(a.entries()) : Object.entries(a)
  const bSize = bIsMap ? b.size : Object.keys(b).length

  if (aEntries.length !== bSize) return false

  // Check each entry exists in b with same value
  for (const [key, value] of aEntries) {
    const bValue = bIsMap ? b.get(key) : b[key]
    if (bValue !== value) return false
  }
  return true
}

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

/**
 * @typedef {object} ParamsUIDeps
 * @property {JscadWorker} workerApi - Worker API
 * @property {(result: object, options?: object) => void} handleEntities - Entities handler
 * @property {(error: unknown) => void} setError - Error handler
 * @property {() => boolean} stopCurrentAnim - Stop current animation
 * @property {() => unknown} [beginRun] - starts a streaming run; returns the runId jscadMain is tagged with
 * @property {() => void} [endRun] - the run failed; keep what it drew
 * @property {() => string[]} [held] - hashes of the meshes the page draws, which the run may send as refs
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

/** @type {ParamsUIDeps|null} H5 fix: Store pending deps for recursive call */
let pendingDeps = null

/** A param-tree change queued while a run holds the work token. Drained by
 * whichever path settles first, so the two paths cannot strand each other. */
let pendingParamChange = null

/** @type {boolean} */
let working = false
let workingSince = 0
let workToken = 0

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
 * Mark a run as in flight
 * @returns {number} token that ends this run's hold on the working state
 */
export function beginWork() {
  working = true
  workingSince = Date.now()
  return ++workToken
}

/**
 * @param {number} token
 * @returns {boolean} whether this run still held the working state, which is now released
 */
export function endWork(token) {
  if (token !== workToken) return false
  working = false
  return true
}

/**
 * A newer run waits for one in flight only while that one is young; an older
 * one is abandoned, since the frame supersedes it.
 * @returns {boolean}
 */
export function mustWait() {
  return working && Date.now() - workingSince < ABANDON_AFTER_MS
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
  const { workerApi, handleEntities, setError, stopCurrentAnim, beginRun, endRun, held } = deps

  // H5 fix: Store deps for pending update to use the most recent deps
  if (mustWait()) {
    modelUpdatePending = true
    pendingDeps = deps
    return
  }

  modelUpdatePending = false
  pendingDeps = null
  stopCurrentAnim()
  const work = beginWork()

  try {
    const runId = beginRun?.()
    const result = await workerApi.jscadMain({ ...paramsCtrl.getWorkerParams(), runId, held: held?.(), supersede: true })
    if (work !== workToken) return

    if (result.proxyState) {
      const oldState = paramsCtrl.proxyState
      paramsCtrl.updateProxyState(result.proxyState)

      const structureChanged = (
        !mapsEqual(oldState?.types, result.proxyState.types) ||
        !mapsEqual(oldState?.classes, result.proxyState.classes)
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
    endRun?.()
    if (err?.name !== 'SupersededError') {
      setError(err)
      console.error('Model update failed:', err)
    }
  } finally {
    // H5 fix: Use stored pendingDeps if available, otherwise fall back to current deps
    if (endWork(work)) {
      if (modelUpdatePending) {
        const depsToUse = pendingDeps || deps
        pendingDeps = null
        modelUpdatePending = false
        runModelUpdate(depsToUse)
      } else if (pendingParamChange) {
        const queued = pendingParamChange
        pendingParamChange = null
        runParamChange(queued.deps, queued.params, queued.source)
      }
    }
  }
}

/**
 * Handle a param-tree change: coalesce rapid changes to the latest params,
 * supersede the frame run in flight, and draw unless a newer run replaced it.
 * Shares the work token with runModelUpdate; each path drains the other's
 * queue on settling so neither strands the other.
 *
 * Decision: no queue of intermediate values. Dragging a slider only needs
 * where the user stopped; noteParams still records every change so intent
 * tracking is complete even though only the latest runs.
 * @param {object} deps - workerApi, onEntities, stopCurrentAnim, paramChange,
 *   beginStream, endStream, held, getMainOptions, noteParams, noteRunParams
 * @param {object} params - the changed params
 * @param {string} [source] - 'group' changes are ignored
 */
export async function runParamChange(deps, params, source) {
  if (source === 'group') return
  deps.noteParams?.(params)
  deps.stopCurrentAnim()
  if (mustWait()) {
    // Intentionally keeps only the latest: dragging a slider processes where
    // the user stopped, not every intermediate value.
    pendingParamChange = { deps, params, source }
    return
  }
  pendingParamChange = null
  const work = beginWork()
  const isStale = deps.paramChange()
  const runId = deps.beginStream(isStale)

  let result
  let pending = null
  let queuedModelUpdate = null
  try {
    result = await deps.workerApi.jscadMain(deps.getMainOptions(params, runId))
    if (isStale()) return
    deps.noteRunParams?.(params)
  } catch (error) {
    deps.endStream(runId)
    if (error?.name === 'SupersededError') return
    throw error
  } finally {
    if (endWork(work)) {
      pending = pendingParamChange
      pendingParamChange = null
      if (!pending && modelUpdatePending && pendingDeps) {
        queuedModelUpdate = pendingDeps
        pendingDeps = null
        modelUpdatePending = false
      }
    }
  }
  deps.onEntities(result, {})
  if (pending && pending.params !== params) runParamChange(pending.deps, pending.params, pending.source)
  else if (queuedModelUpdate) runModelUpdate(queuedModelUpdate)
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

  // Use Set for O(1) lookups instead of O(n) array.includes()
  const linkedPathsSet = new Set(linkedPaths)

  // Update linked inputs in DOM directly (don't re-render whole tree)
  const inputs = document.querySelectorAll('[data-param-path]')
  for (const input of inputs) {
    const path = input.dataset.paramPath
    if (linkedPathsSet.has(path) && path !== paramPath) {
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
