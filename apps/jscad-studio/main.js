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
import * as editor from './src/editor.js'
import * as engine from './src/engine.js'
import * as menu from './src/menu.js'
import { setError } from './src/error.js'
import { ViewState } from './src/viewState.js'
import * as paramsUI from './src/paramsUI.js'
import { updatePipelineStats, countGeometry, createProgressHandler } from './src/stats.js'
import { frameClient } from './src/frameClient.js'
import { capGeometry, DEFAULT_CAPS } from './src/caps.js'

// Injected by esbuild at build time (see build.js).
const RUN_ORIGIN = __RUN_ORIGIN__

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = id => /** @type {HTMLElement} */(document.getElementById(id))

// A default model exercising the params proxy, so the parameter controls have
// something to show on first load.
const DEFAULT_CODE = [
  `const { cube } = require('@jscad/modeling').primitives`,
  `const main = (params) => {`,
  `  params.size = { type: 'slider', default: 10, min: 1, max: 100 }`,
  `  return cube({ size: params.size })`,
  `}`,
  `module.exports = { main }`,
].join('\n')

// ============== View & Camera Setup ==============
const viewState = new ViewState()
const gizmo = new Gizmo()
byId('layout').append(gizmo)

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

// ============== Compute Frame ==============
const frameApi = frameClient(byId('frame'), RUN_ORIGIN)

// True once the first load succeeded, so re-renders do not fire before then.
let loadedOnce = false

/**
 * Handle entities from the frame
 * @param {{entities:unknown | Array<unknown>,treeTime?:number,execTime?:number,convTime?:number}} result
 * @param {{skipLog?:boolean }} options
 */
const handleEntities = (result, { skipLog } = {}) => {
  const { entities: rawEntities, treeTime, execTime, convTime } = result
  const entities = rawEntities instanceof Array ? rawEntities : [rawEntities]

  // The frame's data is untrusted input; refuse to draw past the caps before
  // any allocation for rendering.
  capGeometry(entities, DEFAULT_CAPS)

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

// The frame's params command takes {values}; the frame marks every sent value
// as user-interacted, which the params proxy requires.
const modelDeps = {
  workerApi: {
    jscadMain: async (mainOptions) => {
      const res = await frameApi.params({ values: mainOptions.params })
      if (!res.ok) {
        const error = new Error(res.error.message)
        error.name = res.error.name || 'Error'
        throw error
      }
      return res.result
    },
  },
  handleEntities,
  setError,
  stopCurrentAnim: () => false,
}

viewState.onRequireReRender = () => {
  if (!loadedOnce) return
  paramsUI.runModelUpdate(modelDeps)
}

// ============== Script Loading ==============

/** @param {{script?:string,url?:string}} options*/
const jscadScript = async ({ script, url = 'main.js' }) => {
  loadDefault = false

  // Reset controller and UI
  paramsCtrl.reset()
  paramsUI.destroyParamsTreeView()

  try {
    const res = await frameApi.load({ files: { [url]: script }, entry: url })
    if (!res.ok) {
      setError(res.error)
      return
    }
    const { result } = res

    if (result.proxyState) {
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
            paramsUI.scheduleModelUpdate(() => paramsUI.runModelUpdate(modelDeps))
          })
        },
        onClassChange: (partPath, newClass, mode) => {
          paramsUI.handleTreeClassChange(partPath, newClass, mode, modelDeps)
        },
      })

      showHiddenCheckbox.onchange = () => {
        paramsTreeView?.setShowHidden(showHiddenCheckbox.checked)
      }
    }

    loadedOnce = true
    handleEntities(result)
  } catch (err) {
    setError(err)
  }
}

// ============== Engine Initialization ==============
viewState.setEngine(await engine.init(viewState.renderEngine))

viewState.onRenderEngineChange = async (newEngine) => {
  console.log('Switching render engine to:', newEngine)

  // Destroy old viewer
  viewState.viewer?.destroy?.()

  // Initialize new viewer
  viewState.setEngine(await engine.init(newEngine))

  // Re-run main with current params to regenerate geometry
  if (loadedOnce) paramsUI.runModelUpdate(modelDeps)
}

paramsUI.injectParamsStyles()

// ============== Editor Initialization ==============
// The save path is a placeholder until the storage layer lands (Task 9).
editor.init(
  DEFAULT_CODE,
  async (script, path) => {
    // The path is the file-map key the frame's load resolves; keep it relative.
    jscadScript({ script, url: path })
  },
  async (script, path) => {
    console.log('save', path, script.length)
  },
  () => undefined,
)

// ============== Menu ==============
menu.init()

// ============== Default Script ==============
if (loadDefault) {
  editor.setSource(DEFAULT_CODE, 'main.js')
  jscadScript({ script: DEFAULT_CODE, url: 'main.js' })
}

// ============== Cleanup on Page Unload ==============
window.addEventListener('unload', () => {
  menu.destroy()
  paramsUI.destroyParamsTreeView()
  editor.destroy()
  viewState.viewer?.destroy?.()
  ctrl.destroy()
})