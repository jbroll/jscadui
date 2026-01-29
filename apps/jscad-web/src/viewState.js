import { makeAxes, makeGrid } from '@jscadui/scene'

import { themes } from './themes.js'

/** 
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = id => /** @type {HTMLElement} */(document.getElementById(id))


/**
 * @typedef {object} ViewStateCamera
 * @property {[number,number,number]} position
 * @property {[number,number,number]} [target]
 */


export class ViewState {
  viewer = undefined

  /**
   * @type {ViewStateCamera}
   */
  camera = {}

  smoothRender
  zoomToFit
  showAxis
  showGrid
  modelingEngine
  renderEngine

  themeName

  theme

  darkModeInput = /** @type {HTMLInputElement} */ (byId('dark-mode'))
  showAxisInput = /** @type {HTMLInputElement} */ (byId('show-axis'))
  showGridInput = /** @type {HTMLInputElement} */ (byId('show-grid'))
  smoothRenderInput = /** @type {HTMLInputElement} */ (byId('smooth-render'))
  zoomToFitInput = /** @type {HTMLInputElement} */ (byId('zoom-to-fit'))
  modelingEngineInput = /** @type {HTMLSelectElement} */ (byId('modeling-engine'))
  renderEngineInput = /** @type {HTMLSelectElement} */ (byId('render-engine'))

  constructor() {
    this.themeName = localStorage.getItem('engine.theme') || 'light'
    if (this.themeName === 'dark') {
      this.darkModeInput.checked = true;
      document.body.classList.add('dark')
    }
    this.theme = themes[this.themeName]
    this.showAxis = localStorage.getItem('engine.showAxis') !== 'false'
    this.showAxisInput.checked = this.showAxis
    this.showGrid = localStorage.getItem('engine.showGrid') !== 'false'
    this.showGridInput.checked = this.showGrid
    this.smoothRender = localStorage.getItem('engine.smoothRender') === 'true'
    this.smoothRenderInput.checked = this.smoothRender
    this.zoomToFit = localStorage.getItem('engine.zoomToFit') === 'true'
    this.zoomToFitInput.checked = this.zoomToFit
    this.modelingEngine = localStorage.getItem('engine.modelingEngine') || 'jscad'
    this.modelingEngineInput.value = this.modelingEngine
    this.renderEngine = localStorage.getItem('engine.renderEngine') || 'threejs'
    this.renderEngineInput.value = this.renderEngine
    const defaultCamera = { position: [180, -180, 220] }
    const cameraLocation = localStorage.getItem('camera.location')
    if (cameraLocation) {
      const parsed = JSON.parse(cameraLocation)
      const isValidArray = arr => Array.isArray(arr) && arr.every(v => Number.isFinite(v))
      const positionValid = isValidArray(parsed?.position)
      const targetValid = !parsed?.target || isValidArray(parsed.target)
      this.camera = positionValid && targetValid ? parsed : defaultCamera
    } else {
      this.camera = defaultCamera
    }

    this.updateTheme()
    this.updateGrid()

    // Bind axis and grid menu options
    this.darkModeInput.addEventListener('change', () => {
      this.themeName = this.darkModeInput.checked ? 'dark' : 'light'
      document.body.classList.toggle('dark', this.darkModeInput.checked)      
      this.setTheme(this.themeName)
    })
    this.smoothRenderInput.addEventListener('change', () => {
      this.setSmoothRender(this.smoothRenderInput.checked)
    })
    this.zoomToFitInput.addEventListener('change', () => {
      this.setZoomToFit(this.zoomToFitInput.checked)
    })
    this.showAxisInput.addEventListener('change', () => this.setAxes(this.showAxisInput.checked))
    this.showGridInput.addEventListener('change', () => this.setGrid(this.showGridInput.checked))
    this.modelingEngineInput.addEventListener('change', () => {
      this.setModelingEngine(this.modelingEngineInput.value)
    })
    this.renderEngineInput.addEventListener('change', () => {
      this.setRenderEngine(this.renderEngineInput.value)
    })
  }

  /**
   * @param {boolean} visible
   */
  setAxes(visible) {
    this.showAxis = visible
    this.updateGrid()
    this.saveState()
  }

  /**
   * @param {boolean} visible
   */
  setGrid(visible) {
    this.showGrid = visible
    this.updateGrid()
    this.saveState()
  }

  /**
   * @param {boolean} smoothRender 
   * @param {boolean} [fireEvent]
   */
  setSmoothRender(smoothRender, fireEvent = true) {
    this.smoothRender = smoothRender
    this.saveState()
    if (fireEvent) this.onRequireReRender()
  }

  /**
   * @param {boolean} zoomToFit
   * @param {boolean} [fireEvent]
   */
  setZoomToFit(zoomToFit, fireEvent = true) {
    this.zoomToFit = zoomToFit
    this.saveState()
    if (fireEvent) this.onRequireReRender()
  }

  /**
   * @param {string} engine - 'jscad' or 'manifold'
   */
  setModelingEngine(engine) {
    this.modelingEngine = engine
    this.saveState()
    this.onModelingEngineChange(engine)
  }

  /**
   * @param {string} engine - 'threejs' or 'regl'
   */
  setRenderEngine(engine) {
    this.renderEngine = engine
    this.saveState()
    this.onRenderEngineChange(engine)
  }

  /**
   * @param {string} themeName
   */
  setTheme(themeName) {
    if (!themes[themeName]) throw new Error(`unknown theme ${themeName}`)
    this.themeName = themeName
    this.theme = themes[themeName]
    this.updateTheme()
    this.updateGrid()
    this.saveState()
  }

  setModel(model) {
    this.model = model
    this.updateScene()
  }

  /**
   * @param {ViewStateCamera} camera
   */
  setCamera(camera) {
    this.camera = camera
    this.viewer?.setCamera(camera)
  }

  /**
   * @param {ViewStateCamera} camera
   */
  saveCamera(camera) {
    // Only save valid camera state to prevent corrupted localStorage
    const isValidArray = arr => Array.isArray(arr) && arr.every(v => Number.isFinite(v))
    if (!isValidArray(camera?.position)) return
    if (camera.target && !isValidArray(camera.target)) return
    this.camera = camera
    localStorage.setItem('camera.location', JSON.stringify(camera))
  }

  updateGrid() {
    const { showAxis, showGrid, theme } = this
    this.axes = showAxis ? [makeAxes(50)] : undefined
    this.grid = showGrid ? makeGrid({ size: 200, color1: theme.grid1, color2: theme.grid2 }) : undefined
    this.updateScene()
  }

  updateTheme() {
    if (this.viewer) {
      this.viewer.setBg(this.theme.bg)
      this.viewer.setMeshColor(this.theme.color)
    }
  }

  updateScene() {
    const { axes, grid, model } = this
    const items = []
    if (axes) items.push({ id: 'axes', items: axes, ignoreBB:true })
    if (grid) items.push({ id: 'grid', items: grid, ignoreBB:true })
    if (model) items.push({ id: 'model', items: model, ignoreBB:false })

    this.viewer?.setScene({ items }, { smooth: this.smoothRender })
  }

  setEngine(viewer) {
    this.viewer = viewer
    this.updateTheme()
    this.updateGrid()
    this.updateScene()
    this.setCamera(this.camera)
  }  

  saveState() {
    localStorage.setItem('engine.theme', this.themeName)
    localStorage.setItem('engine.showAxis', String(this.showAxis))
    localStorage.setItem('engine.showGrid', String(this.showGrid))
    localStorage.setItem('engine.smoothRender', String(this.smoothRender))
    localStorage.setItem('engine.zoomToFit', String(this.zoomToFit))
    localStorage.setItem('engine.modelingEngine', this.modelingEngine)
    localStorage.setItem('engine.renderEngine', this.renderEngine)
  }

  onRequireReRender() { }

  /** @param {string} _engine */
  onModelingEngineChange(_engine) { }

  /** @param {string} _engine */
  onRenderEngineChange(_engine) { }
}
