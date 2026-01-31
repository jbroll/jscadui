import { JscadToCommon } from '@jscadui/format-jscad'
import { messageProxy, withTransferable } from '@jscadui/postmessage'
import { clearFileCache, jscadClearTempCache, readFileWeb, require, requireCache, resolveUrl } from '@jscadui/require'
import { createParamsProxy, createProxyState, buildParamTree, toParamDefinitions, extractDefaults as extractProxyDefaults, convertLegacyDefs, injectLegacyDefs } from '@jscadui/params-core'

import { exportStlText } from './src/exportStlText.js'
import { combineParameterDefinitions, getParameterDefinitionsFromSource } from './src/getParameterDefinitionsFromSource.js'
import { extractDefaults } from './src/extractDefaults.js'
import { extractPathInfo, readAsArrayBuffer, readAsText } from '../fs-provider/fs-provider.js'

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

/** @type {import('@jscadui/format-common').JscadMainFunctionRaw | undefined} */
let main

/** @type {import('@jscadui/format-common').JscadModule} */
let scriptModule = {}

globalThis.JSCAD_WORKER_ENV = {}

/**
 * Simple mutex to serialize script execution and prevent race conditions
 * when multiple jscadScript calls are made concurrently
 */
let scriptLock = Promise.resolve()

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
    // On timeout, release the lock so subsequent scripts can run
    release()
    throw err
  }

  return release
}

/** @type {TransformFunction} */
let transformFunc = x => x

let globalBase = location.origin
/** @type {boolean | undefined } */
let userInstances

/** @type {boolean | undefined } */
let useParamsProxy

/** @type {ImportData | undefined} */
let importData

// Params proxy state - persists across jscadMain calls
/** @type {Set<string>} */
let userInteracted = new Set()
/** @type {Object} */
let currentUiValues = {}
/** @type {Object | null} */
let legacyProxyDefs = null

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
  if (baseURI) globalBase = baseURI

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
  userInstances = options.userInstances
  useParamsProxy = options.useParamsProxy
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

/** @type {import('@jscadui/format-common').JscadMainResultRaw[]} */
let solids = []

/** @type {import('@jscadui/params-core').ProxyState | null} */
let _lastProxyState = null

/**
 * @param {{params?:import('@jscadui/format-common').UserParameters,skipLog?:boolean,userInteractedPaths?:string[],useGpuNormals?:boolean}} options
 * @returns {Promise<import('@jscadui/format-common').JscadMainResult>}
 */
export async function jscadMain({ params, skipLog: _skipLog, userInteractedPaths, useGpuNormals } = {}) {
  // Update GPU normals setting if provided (allows switching without re-running script)
  if (useGpuNormals !== undefined) {
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (modelingBundleUrl) {
      const modelingModule = requireCache.module[modelingBundleUrl] || requireCache.local[modelingBundleUrl]
      if (modelingModule?.setUseGpuNormals) {
        modelingModule.setUseGpuNormals(useGpuNormals)
      }
    }
  }

  // Track which params the user has interacted with
  if (userInteractedPaths) {
    userInteractedPaths.forEach(p => userInteracted.add(p))
  }

  // Handle file params
  params = {...params}
  for(const p in params){
    if(params[p] instanceof File && importData){
      const info = extractPathInfo(params[p].name)
      const content = await readFileFile(params[p],{bin: importData.isBinaryExt(info.ext)})
      params[p] = importData.deserialize(info, content)
    }
  }

  // Store UI values for proxy
  if (useParamsProxy) {
    currentUiValues = params
  }

  /** @type {import('@jscadui/format-common').JscadTransferable []} */
  const transferable = []

  if (!main) throw new Error('no main function exported')

  let time = performance.now()
  let treeTime = 0
  let execTime = 0
  let convTime = 0

  try {
    // Run main with either proxy or plain params
    // For Manifold: this builds the lazy operation tree (fast)
    // For JSCAD: this does all the actual CSG work (treeTime will be 0, work is immediate)
    let proxyState = null
    if (useParamsProxy) {
      // Use 'flat' mode for legacy scripts (those with getParameterDefinitions)
      // This preserves compatibility with the `params.prop || default` pattern
      // Use 'hierarchical' mode for new scripts that use nested params
      const mode = legacyProxyDefs ? 'flat' : 'hierarchical'
      proxyState = createProxyState(currentUiValues, userInteracted, { mode })
      const proxyParams = createParamsProxy(proxyState)

      // Inject legacy parameter definitions if the script has getParameterDefinitions
      // This promotes legacy scripts to work with the params proxy system
      if (legacyProxyDefs) {
        injectLegacyDefs(proxyParams, legacyProxyDefs)
      }

      solids = flatten(await main(proxyParams))
      _lastProxyState = proxyState
    } else {
      solids = flatten(await main(params || {}))
    }

    treeTime = performance.now() - time

    // Force evaluation of lazy Manifold geometries
    // This triggers actual CSG computation; result is cached for getMesh()
    time = performance.now()
    for (const solid of solids) {
      if (solid && solid.isManifoldGeom3) {
        solid.manifold.numTri() // Forces evaluation, caches result
      }
    }
    execTime = performance.now() - time

    // Convert to render format (getMesh + common format conversion)
    time = performance.now()
    JscadToCommon.clearCache()
    const entities = JscadToCommon.prepare(solids, transferable, userInstances).all
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
    }

    return withTransferable(result, transferable)
  } catch (error) {
    // Clear cache on error to avoid stale state
    JscadToCommon.clearCache()
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
const jscadScript = async ({ script, url='jscad.js', base=globalBase, root=base, useGpuNormals: gpuNormals }) => {
  // Acquire lock to prevent race conditions with concurrent script executions
  const release = await acquireScriptLock()
  try {
    console.log('run script with base:', base, useParamsProxy ? '(proxy mode)' : '')

    // Reset proxy state for new script
    userInteracted = new Set()
    currentUiValues = {}
    legacyProxyDefs = null

    if(!script) script = readFileWeb(resolveUrl(url, base, root).url)

    const shouldTransform = url.endsWith('.ts') || script.includes('import') && (importReg.test(script) || exportReg.test(script))
    let def = []

    try{
      scriptModule = require({url,script}, shouldTransform ? transformFunc : undefined, readFileWeb, base, root, importData)
    }catch(e){
      // with syntax error in browser we do not get nice stack trace
      // we then try to parse the script to let transform function generate nice error with nice trace
      if(e.name === 'SyntaxError') transformFunc(script, url)
      // if error is not SyntaxError or if transform func does not find syntax err (very unlikely)
      throw e
    }

    // Wait for WASM initialization if using a bundle with async init (e.g., Manifold)
    // This ensures WASM is ready before user code runs
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (modelingBundleUrl) {
      // Check both local and module caches - bundles may be in either depending on URL
      const modelingModule = requireCache.module[modelingBundleUrl] || requireCache.local[modelingBundleUrl]
      if (modelingModule?.ready instanceof Promise) {
        await modelingModule.ready
      }
      // Configure GPU normals mode based on renderer capability
      if (gpuNormals !== undefined && modelingModule?.setUseGpuNormals) {
        modelingModule.setUseGpuNormals(gpuNormals)
      }
    }

    main = scriptModule.main
    // if the main function is the default export
    if(!main && typeof scriptModule == 'function') main = scriptModule

    let params = {}
    if (useParamsProxy) {
      // Check if script has legacy getParameterDefinitions and convert them
      // This allows legacy scripts to work with the params proxy system
      const legacyDefs = await scriptModule.getParameterDefinitions?.()
      if (legacyDefs && legacyDefs.length > 0) {
        legacyProxyDefs = convertLegacyDefs(legacyDefs)
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
  if(self.exportData) return self.exportData(params)

  // todo check if it is ok to give back transferables after webgl has used the buffers
  // then we would not need to clone the data
  // other option is to clone data before sending transferable
  JscadToCommon.clearCache()
  const entities = JscadToCommon.ConvertMulti(solids, [], false)

  const arr = exportStlText(entities)
  const data = [await new Blob(arr).arrayBuffer()]
  return withTransferable({ data }, data)
}

export const currentSolids = ()=>solids

const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache:clearFileCache, jscadExportData }
// allow main thread to call worker methods and any method from the loaded script
const handlersProxy = new Proxy(handlers, {
  get(target, prop, _receiver) {
    return target[prop] || scriptModule[prop]
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
  if (transform) transformFunc = transform
  if (jscadExportData) handlers.jscadExportData = jscadExportData
  importData = _importData
  if (customHandlers) Object.assign(handlers, customHandlers)

  JSCAD_WORKER_ENV.client = messageProxy(self, handlersProxy)
}


