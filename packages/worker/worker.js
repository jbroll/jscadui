import { JscadToCommon } from '@jscadui/format-jscad'
import { messageProxy, withTransferable } from '@jscadui/postmessage'
import { clearFileCache, jscadClearTempCache, readFileWeb, require, requireCache, resolveUrl } from '@jscadui/require'
import { createParamsProxy, createProxyState, buildParamTree, toParamDefinitions, extractDefaults as extractProxyDefaults, convertLegacyDefs, injectLegacyDefs } from '@jscadui/params-core'

import { exportStlText } from './src/exportStlText.js'
import { combineParameterDefinitions, getParameterDefinitionsFromSource } from './src/getParameterDefinitionsFromSource.js'
import { extractDefaults } from './src/extractDefaults.js'
import { extractPathInfo, readAsArrayBuffer, readAsText } from '../fs-provider/fs-provider.js'
import { workerState } from './src/state/workerState.js'

/**
@typedef Alias
 @prop {String} name
 @prop {String} path

@typedef RunScriptOptions
 @prop {string} [script] - script source
 @prop {string} url - script url/name
 @prop {string} base - base url 
 @prop {string} [root] - root (do not allow paths below that root)  

 @typedef ExportDataOptions
 @prop {string} format

 @typedef RunMainOptions
 @prop {import('@jscadui/format-common').UserParameters} params
 @prop {boolean} [skipLog]

 @typedef InitOptions
 @prop {string} [baseURI] - to resolve initial relative path
 @prop {Array<Alias>} [alias] -
 @prop {Object.<string,string>} [bundles] - bundle alias {name:path}
 @prop {boolean} [userInstances] called useInstances at other places
 @prop {boolean} [useParamsProxy] - use params proxy for hierarchical parameter discovery


@typedef JscadWorker
@prop {(options:InitOptions)=>Promise<void>} jscadInit
@prop {(options:RunMainOptions)=>Promise<import('@jscadui/format-common').JscadMainResult>} jscadMain - run the main method of the loaded script
@prop {(options:RunScriptOptions)=>Promise<import('@jscadui/format-common').JscadScriptResultWithParams>} jscadScript - run a jscad script
@prop {(options:ExportDataOptions)=>Promise<unknown>} jscadExportData
@prop {(options:import('@jscadui/require').ClearFileCacheOptions)=>Promise<void>} jscadClearFileCache
@prop {()=>Promise<void>} jscadClearTempCache
@prop {()=>Promise<import('@jscadui/format-common/src/exportFormats.js').ExportFormatInfo[]>} [jscadGetExportFormats] - get available export formats

@typedef ImportData
@prop {(ext:string) => boolean } isBinaryExt
@prop {(options:{url:string, filename:string, ext:string}, fileContent:string | ArrayBuffer ) => unknown} deserialize //TODO

@typedef {(script:string,url:string)=>string} TransformFunction
*/

globalThis.JSCAD_WORKER_ENV = {}

/**
 * Simple mutex to serialize script execution and prevent race conditions
 * when multiple jscadScript calls are made concurrently
 */
let scriptLock = Promise.resolve()

/**
 * C6 fix: Reset script lock on catastrophic errors
 * This prevents one bad script from permanently deadlocking the worker
 */
const resetScriptLock = () => {
  scriptLock = Promise.resolve()
}

// Global error handlers to reset lock on uncaught errors
// M6 fix: Also clear geometry state to free memory after catastrophic errors
// Note: clearWorkerState is defined later after variable declarations
self.addEventListener('error', (event) => {
  console.error('Worker uncaught error:', event.error)
  resetScriptLock()
  workerState.clearGeometry()
})

self.addEventListener('unhandledrejection', (event) => {
  console.error('Worker unhandled rejection:', event.reason)
  resetScriptLock()
  workerState.clearGeometry()
})

/**
 * Timeout in ms to wait for script lock before giving up
 * Default: 30 seconds. Set to 0 to disable timeout.
 */
let scriptLockTimeout = 30000

/**
 * Configure the script lock timeout
 * @param {number} ms - Timeout in milliseconds (0 to disable)
 */
export const setScriptLockTimeout = (ms) => {
  scriptLockTimeout = ms
}

/**
 * Acquire the script execution lock
 * @returns {Promise<() => void>} Release function
 * @throws {Error} If timeout waiting for previous script to complete
 */
const acquireScriptLock = async () => {
  let release
  const previousLock = scriptLock
  scriptLock = new Promise(resolve => {
    release = resolve
  })

  // If no timeout, wait indefinitely
  if (scriptLockTimeout === 0) {
    await previousLock
    return release
  }

  // Race against timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(
      `Script lock timeout: previous script did not complete within ${scriptLockTimeout}ms. ` +
      'This may indicate an infinite loop in user code.'
    )), scriptLockTimeout)
  })

  try {
    await Promise.race([previousLock, timeoutPromise])
  } catch (err) {
    // On timeout, release lock for subsequent scripts.
    // NOTE: Timed-out script may still be running - JS can't terminate running code.
    release()
    throw err
  }

  return release
}

// All worker state is now managed by the workerState singleton
// See src/state/workerState.js for the consolidated state object

/**
 * @template T
 * @param {T | T[]} arr 
 * @returns {T[]}
 */
export const flatten = arr=>{
  /** @type {T[]} */
  const out = []

  /** @param {T |T[]} _in */
  const doFlatten = (_in) => {
    if(_in instanceof Array){
      _in.forEach(el => doFlatten(el))
    }else{
      out.push(_in)
    }
  }

  doFlatten(arr)
  return out
}

/**
 * @param {InitOptions} options
 */
export const jscadInit = options => {
  const { baseURI, alias = [], bundles = {} } = options
  if (baseURI) workerState.globalBase = baseURI

  // Check if the modeling bundle is changing - if so, clear local cache
  // to force user scripts to be re-evaluated with the new bundle
  const oldModelingBundle = requireCache.bundleAlias['@jscad/modeling']
  const newModelingBundle = bundles['@jscad/modeling']
  if (oldModelingBundle && newModelingBundle && oldModelingBundle !== newModelingBundle) {
    console.log('Modeling bundle changed, clearing local cache')
    jscadClearTempCache()
  }

  if (bundles) Object.assign(requireCache.bundleAlias, bundles)
  // workspace aliases
  alias.forEach(({ name, path }) => {
    requireCache.alias[name] = path
  })
  console.log('init alias', alias, 'bundles',bundles)
  workerState.userInstances = options.userInstances
  workerState.useParamsProxy = options.useParamsProxy
}
/**
 * @param {import('../fs-provider/fs-provider.js').FSFileEntry | Blob} file 
 * @param {{bin?:boolean}} options 
 * @returns {Promise<ArrayBuffer | string>}
 */
async function readFileFile(file, {bin=false}={}){
  if(bin) return await readAsArrayBuffer(file)
  else return readAsText(file)
}


/**
 * @param {{params?:import('@jscadui/format-common').UserParameters,skipLog?:boolean,userInteractedPaths?:string[],useGpuNormals?:boolean}} options
 * @returns {Promise<import('@jscadui/format-common').JscadMainResult>}
 */
export async function jscadMain({ params, skipLog: _skipLog, userInteractedPaths, useGpuNormals } = {}) {
  // Update GPU normals setting if provided (allows switching without re-running script)
  if (useGpuNormals !== undefined) {
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (modelingBundleUrl) {
      let modelingModule
      try { modelingModule = require(modelingBundleUrl, null, readFileWeb) } catch { /* ignore */ }
      if (modelingModule?.setUseGpuNormals) modelingModule.setUseGpuNormals(useGpuNormals)
    }
  }

  // Track which params the user has interacted with
  // M11 fix: Limit set size to prevent unbounded growth
  const MAX_INTERACTED_PATHS = 1000
  if (userInteractedPaths) {
    userInteractedPaths.forEach(p => workerState.userInteracted.add(p))
    // Clear oldest entries if set grows too large
    if (workerState.userInteracted.size > MAX_INTERACTED_PATHS) {
      const toKeep = [...workerState.userInteracted].slice(-MAX_INTERACTED_PATHS)
      workerState.userInteracted = new Set(toKeep)
    }
  }

  // Handle file params
  // H25 fix: Wrap in try-catch with context about which parameter failed
  params = {...params}
  for(const p in params){
    if(params[p] instanceof File && importData){
      try {
        const info = extractPathInfo(params[p].name)
        const content = await readFileFile(params[p],{bin: importData.isBinaryExt(info.ext)})
        params[p] = importData.deserialize(info, content)
      } catch (err) {
        throw new Error(`Failed to deserialize file parameter "${p}": ${err.message}`)
      }
    }
  }

  // Store UI values for proxy
  if (workerState.useParamsProxy) {
    console.log('[STORE] Storing currentUiValues:', params)
    workerState.currentUiValues = params
  }

  /** @type {import('@jscadui/format-common').JscadTransferable []} */
  const transferable = []

  if (!workerState.main) throw new Error('no main function exported')

  let time = performance.now()
  let treeTime = 0
  let execTime = 0
  let convTime = 0

  try {
    // Run main with either proxy or plain params
    // For Manifold: this builds the lazy operation tree (fast)
    // For JSCAD: this does all the actual CSG work (treeTime will be 0, work is immediate)
    let proxyState = null
    if (workerState.useParamsProxy) {
      if (workerState.legacyProxyDefs) {
        // Legacy scripts with getParameterDefinitions need ISOLATED state
        // to prevent parameter pollution between examples in ALL.js
        // Filter userInteracted to only defined params
        const definedParams = new Set(Object.keys(workerState.legacyProxyDefs))
        const filteredInteracted = new Set([...workerState.userInteracted].filter(path => definedParams.has(path)))

        // Create isolated hierarchical state (NOT shared with any parent)
        proxyState = createProxyState(workerState.currentUiValues, filteredInteracted, { mode: 'hierarchical' })
        const proxyParams = createParamsProxy(proxyState)

        // Inject legacy defs and seal the proxy
        injectLegacyDefs(proxyParams, workerState.legacyProxyDefs)

        workerState.solids = flatten(await workerState.main(proxyParams))
      } else {
        // New hierarchical param system - shared state for nested parts
        proxyState = createProxyState(workerState.currentUiValues, workerState.userInteracted, { mode: 'hierarchical' })
        const proxyParams = createParamsProxy(proxyState)

        workerState.solids = flatten(await workerState.main(proxyParams))
      }
      workerState._lastProxyState = proxyState
    } else {
      workerState.solids = flatten(await workerState.main(params || {}))
    }

    treeTime = performance.now() - time

    // Force evaluation of lazy Manifold geometries
    // This triggers actual CSG computation; result is cached for getMesh()
    time = performance.now()
    for (const solid of workerState.solids) {
      if (solid && solid.isManifoldGeom3) {
        solid.manifold.numTri() // Forces evaluation, caches result
      }
    }
    execTime = performance.now() - time

    // Convert to render format (getMesh + common format conversion)
    // 2.3: No clearCache() here — WeakMap evicts stale entries automatically on GC,
    // and stable IDs across renders improve instance detection grouping.
    // Cache is only cleared on error (below) to ensure clean state after failures.
    time = performance.now()
    const entities = JscadToCommon.prepare(workerState.solids, transferable, workerState.userInstances).all
    convTime = performance.now() - time

    const result = { entities, treeTime, execTime, convTime }

    // Include proxy state info in result
    if (proxyState) {
      result.proxyState = {
        discovered: proxyState.discovered,
        types: Object.fromEntries(proxyState.types),
        classes: Object.fromEntries(proxyState.classes),
        tree: buildParamTree(proxyState.discovered, proxyState.types, proxyState.classes),
      }

      // I2 fix: Prune stale paths from userInteracted to prevent memory leak
      // Only keep paths that exist in the current parameter structure
      const discoveredSet = new Set(proxyState.discovered)
      for (const path of workerState.userInteracted) {
        if (!discoveredSet.has(path)) {
          workerState.userInteracted.delete(path)
        }
      }
    }

    return withTransferable(result, transferable)
  } catch (error) {
    // Clear cache on error to avoid stale state
    JscadToCommon.clearCache()
    workerState.clearGeometry() // M1 fix: Also clear solids array on error to free memory
    // Re-throw with additional context
    const message = error.message || String(error)
    const wrappedError = new Error(`jscadMain failed: ${message}`)
    wrappedError.stack = error.stack
    wrappedError.name = error.name || 'Error'
    throw wrappedError
  }
}

// https://stackoverflow.com/questions/52086611/regex-for-matching-js-import-statements
const importReg = /import(?:(?:(?:[ \n\t]+([^ *\n\t{},]+)[ \n\t]*(?:,|[ \n\t]+))?([ \n\t]*\{(?:[ \n\t]*[^ \n\t"'{}]+[ \n\t]*,?)+\})?[ \n\t]*)|[ \n\t]*\*[ \n\t]*as[ \n\t]+([^ \n\t{}]+)[ \n\t]+)from[ \n\t]*(?:['"])([^'"\n]+)(['"])/
const exportReg = /export.*from/

/**
 * @param {{script:string,url?:string,base?:string,root?:string,useGpuNormals?:boolean}} param0
 * @returns {Promise<import('@jscadui/format-common').JscadScriptResultWithParams>}
 */
const jscadScript = async ({ script, url='jscad.js', base=workerState.globalBase, root=base, useGpuNormals: gpuNormals }) => {
  // I1 fix: Increment generation to invalidate any timed-out scripts still running
  const myGeneration = workerState.nextGeneration()

  // Acquire lock to prevent race conditions with concurrent script executions
  const release = await acquireScriptLock()
  try {
    // I1 fix: Check if we're still the current generation after acquiring lock
    // A timeout may have released the lock and allowed another script to start
    if (myGeneration !== workerState.getGeneration()) {
      throw new Error('Script execution superseded by newer script')
    }

    console.log('run script with base:', base, workerState.useParamsProxy ? '(proxy mode)' : '')

    // Reset proxy state for new script
    workerState.userInteracted = new Set()
    workerState.currentUiValues = {}
    workerState.legacyProxyDefs = null
    workerState.solids = [] // C2 fix: Clear solids array to prevent memory leak on script reload

    if(!script) script = readFileWeb(resolveUrl(url, base, root).url)

    const shouldTransform = url.endsWith('.ts') || script.includes('import') && (importReg.test(script) || exportReg.test(script))
    let def = []

    try{
      const loadedModule = require({url,script}, shouldTransform ? workerState.transformFunc : undefined, readFileWeb, base, root, workerState.importData)
      // I1 fix: Check generation before setting shared state
      if (myGeneration !== workerState.getGeneration()) {
        throw new Error('Script execution superseded by newer script during module load')
      }
      workerState.scriptModule = loadedModule
    }catch(e){
      // with syntax error in browser we do not get nice stack trace
      // we then try to parse the script to let transform function generate nice error with nice trace
      if(e.name === 'SyntaxError') workerState.transformFunc(script, url)
      // if error is not SyntaxError or if transform func does not find syntax err (very unlikely)
      throw e
    }

    // Wait for WASM initialization if using a bundle with async init (e.g., Manifold)
    // This ensures WASM is ready before user code runs
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (modelingBundleUrl) {
      // require() returns the live cached bundle; requireCache.module is a no-op getter,
      // so the old lookup skipped this await → "Manifold WASM not initialized" on cold loads.
      let modelingModule
      try { modelingModule = require(modelingBundleUrl, null, readFileWeb) } catch { /* ignore */ }
      if (modelingModule?.ready instanceof Promise) await modelingModule.ready
      if (gpuNormals !== undefined && modelingModule?.setUseGpuNormals) modelingModule.setUseGpuNormals(gpuNormals)
    }

    // C1 fix: Check generation after async WASM init to prevent stale script from corrupting main
    if (myGeneration !== workerState.getGeneration()) {
      throw new Error('Script execution superseded during WASM initialization')
    }

    workerState.main = workerState.scriptModule.main
    // if the main function is the default export
    if(!workerState.main && typeof workerState.scriptModule == 'function') workerState.main = workerState.scriptModule

    let params = {}
    if (workerState.useParamsProxy) {
      // Check if script has legacy getParameterDefinitions and convert them
      // This allows legacy scripts to work with the params proxy system
      const legacyDefs = await workerState.scriptModule.getParameterDefinitions?.()
      if (legacyDefs && legacyDefs.length > 0) {
        workerState.legacyProxyDefs = convertLegacyDefs(legacyDefs)
      }

      // In proxy mode, run main to discover params, then extract defaults
      const out = await jscadMain({ params: {} })
      if (out.proxyState) {
        def = toParamDefinitions(out.proxyState.discovered)
        params = extractProxyDefaults(out.proxyState.discovered)
      }
      return {
        def,
        params,
        ...out,
      }
    } else {
      // Traditional mode: use getParameterDefinitions
      const fromSource = getParameterDefinitionsFromSource(script)
      def = combineParameterDefinitions(fromSource, await scriptModule.getParameterDefinitions?.())
      params = extractDefaults(def)
      const out = await jscadMain({ params })
      return {
        def,
        params,
        ...out,
      }
    }
  } finally {
    release()
  }
}

// TODO remove, or move to another package, along with exportStlText
// this is interesting in regards to exporting to stl, and 3mf which actually need vertex data, 
// and not jscad geometry polygons. So it will be interesting to can give back transferable buffers
// instead of re-running conversion. or move export to main thread where the data already is, as it is needed for rendering
/**
 * @param {ExportDataOptions} params 
 * @returns {Promise<{data:ArrayBuffer[]}>}
 */
const jscadExportData = async (params) => {
  // L3 fix: Document hook - self.exportData can be set externally to override default export behavior
  // Set self.exportData = async (params) => ({data: ArrayBuffer[]}) to customize export
  if(self.exportData) return self.exportData(params)

  // todo check if it is ok to give back transferables after webgl has used the buffers
  // then we would not need to clone the data
  // other option is to clone data before sending transferable
  JscadToCommon.clearCache()
  const entities = JscadToCommon.ConvertMulti(workerState.solids, [], false)

  const arr = exportStlText(entities)
  const data = [await new Blob(arr).arrayBuffer()]
  return withTransferable({ data }, data)
}

export const currentSolids = () => workerState.solids

const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache:clearFileCache, jscadExportData }
// allow main thread to call worker methods and any method from the loaded script
const handlersProxy = new Proxy(handlers, {
  get(target, prop, _receiver) {
    return target[prop] || workerState.scriptModule[prop]
  }
})

/**
 * @typedef {Object} InitWorkerOptions
 * @property {TransformFunction} [transform]
 * @property {(options:ExportDataOptions)=>Promise<{data:ArrayBuffer[]}>} [jscadExportData]
 * @property {ImportData} [importData]
 * @property {Object.<string, Function>} [customHandlers] - Additional handlers to expose
 */

/**
 * Initialize the worker with optional configuration.
 * @param {InitWorkerOptions} [options={}]
 */
export const initWorker = (options = {}) => {
  const { transform, jscadExportData, importData: _importData, customHandlers } = options
  if (transform) workerState.transformFunc = transform
  if (jscadExportData) handlers.jscadExportData = jscadExportData
  workerState.importData = _importData
  if (customHandlers) Object.assign(handlers, customHandlers)

  JSCAD_WORKER_ENV.client = messageProxy(self, handlersProxy)
}


