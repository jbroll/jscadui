import { JscadToCommon } from '@jscadui/format-jscad'
import { messageProxy, withTransferable } from '@jscadui/postmessage'
import { clearFileCache, jscadClearTempCache, readFileWeb, require, requireCache, resolveUrl } from '@jscadui/require'
import { createParamsProxy, createProxyState, buildParamTree, toParamDefinitions, extractDefaults as extractProxyDefaults } from '@jscadui/params-core'

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
  let { baseURI, alias = [], bundles = {} } = options
  if (baseURI) globalBase = baseURI

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
let lastProxyState = null

/**
 * @param {{params?:import('@jscadui/format-common').UserParameters,skipLog?:boolean,userInteractedPaths?:string[]}} options
 * @returns {Promise<import('@jscadui/format-common').JscadMainResult>}
 */
export async function jscadMain({ params, skipLog, userInteractedPaths } = {}) {
  // Track which params the user has interacted with
  if (userInteractedPaths) {
    userInteractedPaths.forEach(p => userInteracted.add(p))
  }

  // Handle file params
  params = {...params}
  for(let p in params){
    if(params[p] instanceof File && importData){
      const info = extractPathInfo(params[p].name)
      let content = await readFileFile(params[p],{bin: importData.isBinaryExt(info.ext)})
      params[p] = importData.deserialize(info, content)
    }
  }

  // Store UI values for proxy
  if (useParamsProxy) {
    currentUiValues = params
  }

  if (!skipLog) {
    console.log('jscadMain with params', params, useParamsProxy ? '(proxy mode)' : '')
    if (useParamsProxy) {
      console.log('  userInteracted paths:', [...userInteracted])
      // Debug: check if specific tireColor paths are in params
      const tireColorPaths = Object.keys(params).filter(k => k.includes('tireColor'))
      console.log('  tireColor params:', tireColorPaths.map(k => ({ path: k, value: params[k] })))
    }
  }
  /** @type {import('@jscadui/format-common').JscadTransferable []} */
  const transferable = []

  if (!main) throw new Error('no main function exported')

  let time = performance.now()

  // Run main with either proxy or plain params
  let proxyState = null
  if (useParamsProxy) {
    proxyState = createProxyState(currentUiValues, userInteracted)
    const proxyParams = createParamsProxy(proxyState)
    solids = flatten(await main(proxyParams))
    lastProxyState = proxyState
  } else {
    solids = flatten(await main(params || {}))
  }

  const mainTime = performance.now() - time

  time = performance.now()
  JscadToCommon.clearCache()
  const entities = JscadToCommon.prepare(solids, transferable, userInstances).all

  const result = { entities, mainTime, convertTime: performance.now() - time }

  // Include proxy state info in result
  if (proxyState) {
    result.proxyState = {
      discovered: proxyState.discovered,
      types: Object.fromEntries(proxyState.types),
      classes: Object.fromEntries(proxyState.classes),
      tree: buildParamTree(proxyState.discovered, proxyState.types, proxyState.classes)
    }
  }

  return withTransferable(result, transferable)
}

// https://stackoverflow.com/questions/52086611/regex-for-matching-js-import-statements
const importReg = /import(?:(?:(?:[ \n\t]+([^ *\n\t\{\},]+)[ \n\t]*(?:,|[ \n\t]+))?([ \n\t]*\{(?:[ \n\t]*[^ \n\t"'\{\}]+[ \n\t]*,?)+\})?[ \n\t]*)|[ \n\t]*\*[ \n\t]*as[ \n\t]+([^ \n\t\{\}]+)[ \n\t]+)from[ \n\t]*(?:['"])([^'"\n]+)(['"])/
const exportReg = /export.*from/

/**
 * @param {{script:string,url?:string,base?:string,root?:string}} param0
 * @returns {Promise<import('@jscadui/format-common').JscadScriptResultWithParams>}
 */
const jscadScript = async ({ script, url='jscad.js', base=globalBase, root=base }) => {
  console.log('run script with base:', base, useParamsProxy ? '(proxy mode)' : '')

  // Reset proxy state for new script
  userInteracted = new Set()
  currentUiValues = {}

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

  main = scriptModule.main
  // if the main function is the default export
  if(!main && typeof scriptModule == 'function') main = scriptModule

  let params = {}
  if (useParamsProxy) {
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
  let entities = JscadToCommon.ConvertMulti(solids, [], false)

  const arr = exportStlText(entities)
  const data = [await new Blob(arr).arrayBuffer()]
  return withTransferable({ data }, data)
}

export const currentSolids = ()=>solids

const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache:clearFileCache, jscadExportData }
// allow main thread to call worker methods and any method from the loaded script
const handlersProxy = new Proxy(handlers, {
  get(target, prop, receiver) {
    return target[prop] || scriptModule[prop]
  }
})

/**
 * @param {TransformFunction | undefined} transform 
 * @param {(options:ExportDataOptions)=>Promise<{data:ArrayBuffer[]}>} [jscadExportData ]
 * @param {ImportData} [_importData]
 */
export const initWorker = (transform, jscadExportData, _importData) => {
  if (transform) transformFunc = transform
  if(jscadExportData) handlers.jscadExportData = jscadExportData
  importData = _importData

  JSCAD_WORKER_ENV.client = messageProxy(self, handlersProxy)
}


