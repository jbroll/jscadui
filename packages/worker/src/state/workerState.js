/**
 * WorkerState - Centralized state management for the JSCAD worker
 *
 * Consolidates all global variables into a single stateful object
 * with clear lifecycle management and state validation.
 *
 * Reduces globals from 13 → 1 and provides clear state boundaries.
 */

/**
 * @typedef {import('@jscadui/format-common').JscadMainFunctionRaw} JscadMainFunctionRaw
 * @typedef {import('@jscadui/format-common').JscadModule} JscadModule
 * @typedef {import('@jscadui/format-common').JscadMainResultRaw} JscadMainResultRaw
 * @typedef {import('@jscadui/params-core').ProxyState} ProxyState
 * @typedef {(script:string,url:string)=>string} TransformFunction
 * @typedef ImportData
 * @prop {(ext:string) => boolean } isBinaryExt
 * @prop {(options:{url:string, filename:string, ext:string}, fileContent:string | ArrayBuffer ) => unknown} deserialize
 */

/**
 * WorkerState class manages all worker-level state
 */
export class WorkerState {
  constructor() {
    // Script execution state
    /** @type {JscadMainFunctionRaw | undefined} */
    this.main = undefined

    /** @type {JscadModule} */
    this.scriptModule = {}

    /** @type {JscadMainResultRaw[]} */
    this.solids = []

    // Configuration state (set by jscadInit)
    /** @type {TransformFunction} */
    this.transformFunc = x => x

    /** @type {string} */
    this.globalBase = typeof location !== 'undefined' ? location.origin : ''

    /** @type {boolean | undefined} */
    this.userInstances = undefined

    /** @type {boolean | undefined} */
    this.useParamsProxy = undefined

    /** @type {ImportData | undefined} */
    this.importData = undefined

    // Parameter proxy state (persists across jscadMain calls)
    /** @type {Set<string>} */
    this.userInteracted = new Set()

    /** @type {Object} */
    this.currentUiValues = {}

    /** @type {Object | null} */
    this.legacyProxyDefs = null

    /** @type {ProxyState | null} */
    this._lastProxyState = null

    // Script generation counter for timeout detection
    /** @type {number} */
    this.scriptGeneration = 0
  }

  /**
   * Reset all state - called on script load errors or for fresh start
   */
  reset() {
    this.main = undefined
    this.scriptModule = {}
    this.solids = []
    this.userInteracted = new Set()
    this.currentUiValues = {}
    this.legacyProxyDefs = null
    this._lastProxyState = null
    this.scriptGeneration = 0
  }

  /**
   * Clear geometry state only - keeps script and config
   * Used after catastrophic errors to free memory
   */
  clearGeometry() {
    this.solids = []
    this._lastProxyState = null
  }

  /**
   * Clear parameter state - called when starting fresh parameter discovery
   */
  clearParams() {
    this.userInteracted = new Set()
    this.currentUiValues = {}
    this.legacyProxyDefs = null
    this._lastProxyState = null
  }

  /**
   * Update script module and main function
   * @param {JscadModule} module
   */
  setScript(module) {
    this.scriptModule = module
    this.main = module.main
  }

  /**
   * Update configuration from jscadInit
   * @param {{
   *   baseURI?: string,
   *   userInstances?: boolean,
   *   useParamsProxy?: boolean,
   *   importData?: ImportData,
   *   transformFunc?: TransformFunction
   * }} config
   */
  configure(config) {
    if (config.baseURI !== undefined) {
      this.globalBase = config.baseURI
    }
    if (config.userInstances !== undefined) {
      this.userInstances = config.userInstances
    }
    if (config.useParamsProxy !== undefined) {
      this.useParamsProxy = config.useParamsProxy
    }
    if (config.importData !== undefined) {
      this.importData = config.importData
    }
    if (config.transformFunc !== undefined) {
      this.transformFunc = config.transformFunc
    }
  }

  /**
   * Increment and return the script generation counter
   * Used to detect stale scripts after timeout
   * @returns {number} The new generation number
   */
  nextGeneration() {
    return ++this.scriptGeneration
  }

  /**
   * Get the current script generation
   * @returns {number}
   */
  getGeneration() {
    return this.scriptGeneration
  }
}

/**
 * Singleton instance for the worker
 */
export const workerState = new WorkerState()
