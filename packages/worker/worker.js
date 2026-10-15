import { JscadToCommon } from '@jscadui/format-jscad'
import { messageProxy, withTransferable } from '@jscadui/postmessage'
import { clearAllCaches, clearFileCache, jscadClearTempCache, readFileWeb, require, requireCache, resolveUrl } from '@jscadui/require'
import { createParamsProxy, createProxyState, buildParamTree, toParamDefinitions, extractDefaults as extractProxyDefaults, convertLegacyDefs, injectLegacyDefs, withProjectMains } from '@jscadui/params-core'

import { exportStlText } from './src/exportStlText.js'
import { combineParameterDefinitions, getParameterDefinitionsFromSource } from './src/getParameterDefinitionsFromSource.js'
import { extractDefaults } from './src/extractDefaults.js'
import { extractPathInfo, readAsArrayBuffer, readAsText } from '../fs-provider/fs-provider.js'
import { workerState } from './src/state/workerState.js'
import { toRefs } from './src/meshRefs.js'
import { createStreamHook, withCopies, withStreamHook } from './src/stream.js'
import { createClaims } from './src/claims.js'
import { shouldTransform } from './src/shouldTransform.js'
import { bindEvaluator, createBuildContext, memoFromSpecials, splitParts, withBuildContext } from '@jscadui/model-tree'
import { loadBoundEvaluate } from './src/treeApi.js'

/**
@typedef Alias
 @prop {String} name
 @prop {String} path

@typedef RunScriptOptions
 @prop {string} [script] - script source
 @prop {string} url - script url/name
 @prop {string} base - base url 
 @prop {string} [root] - root (do not allow paths below that root)  
 @prop {boolean} [scratch] - the chat's scratch run: run the script and its main, answer what it printed and returned, and leave the loaded model as it was

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
 @prop {boolean} [claims] - the host answers jscadClaim, so a grid claims each leaf before running it


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

// Reset on catastrophic errors so one bad script cannot permanently deadlock
// the worker.
const resetScriptLock = () => {
  scriptLock = Promise.resolve()
}

// Uncaught errors reset the lock and clear geometry to free memory.
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

// Timeout in ms to wait for the script lock before giving up.
const scriptLockTimeout = 30000

/** @type {{reset: () => void, list: () => Array<{fn: string, option: string, suggestions?: string[], hint?: string}>} | null} */
let runWarnings = null

/**
 * The collector model code reports to; jscadScript clears it and jscadMain
 * returns what it holds.
 * @param {{reset: () => void, list: () => Array<object>} | null} collector
 */
export const setRunWarnings = (collector) => {
  runWarnings = collector
}

/** @type {{reset: () => void, list: () => string[]} | null} */
let runConsole = null

/**
 * The collector model code's console calls report to; jscadScript clears it
 * and jscadMain returns what it holds.
 * @param {{reset: () => void, list: () => string[]} | null} collector
 */
export const setRunConsole = (collector) => {
  runConsole = collector
}

/** @type {(() => (() => void)) | null} */
let isolateModel = null

/**
 * Registers what resets the state library modules keep for the model that
 * set it up (jscad-text's init, say). jscadScript calls it before each load,
 * so every model starts clean; a scratch run calls the function it returns
 * afterwards, putting the loaded model's state back.
 * @param {(() => (() => void)) | null} isolate
 */
export const setModelIsolation = (isolate) => {
  isolateModel = isolate
}

const noMainError = () => Object.assign(new Error('no main function exported'), { name: 'NoMainError' })

/**
 * A run the worker abandoned because a newer script or run started. The name
 * is the same one the frame answers (`SupersededError`), so the app's name
 * checks treat a worker-abandoned run like a frame-superseded one: no error
 * is shown and the run draws nothing.
 */
export class SupersededError extends Error {
  constructor(message = 'superseded by a newer run') {
    super(message)
    this.name = 'SupersededError'
  }
}

/** @type {((run: {hasMain: boolean, value: unknown}) => object) | null} */
let runSummary = null

/**
 * Turns what a scratch run's main returned (or its module exports, with no
 * main) into plain data for the answer; the host knows how to measure it.
 * @param {((run: {hasMain: boolean, value: unknown}) => object) | null} summarize
 */
export const setRunSummary = (summarize) => {
  runSummary = summarize
}

const runOutput = () => ({ console: runConsole?.list() ?? [], warnings: runWarnings?.list() ?? [] })

// The plain jscad engine has no getModule, so it reports 0.
const wasmHeap = () => {
  try {
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (!modelingBundleUrl) return 0
    return require(modelingBundleUrl, null, readFileWeb)?.getModule?.()?.HEAPU8?.length ?? 0
  } catch {
    return 0
  }
}

const claims = createClaims({ post: (message) => self.postMessage(message), heap: wasmHeap })

export const answerClaim = claims.answer

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

  // Race the previous script against the timeout
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

// A root-level ghost belongs to no part: a % overlay marker or a previewOnly
// entity the model returned beside its solids.
const isRootGhostNode = (node) => Boolean(node && (node.op === 'ghost' || node.previewOnly))

// A root ghost streams under this trailing claim. Split part keys are digits
// joined by '+' (model-tree splitter), so a word can never collide with one:
// a count like `${parts.length}` can, once an anchor merge shrinks the part
// count below a retained singleton's index.
const ROOT_GHOST_KEY = 'ghost'

/**
 * @param {InitOptions} options
 */
export const jscadInit = options => {
  const { baseURI, alias = [], bundles = {} } = options
  if (baseURI) workerState.globalBase = baseURI

  // The anchors build keeps one URL across engines, so cached CDN modules still hold the old engine.
  const modelingChanged = ['@jscad/modeling', '@jscad/modeling-for-anchors'].some(name => {
    const old = requireCache.bundleAlias[name]
    return old && bundles[name] && old !== bundles[name]
  })
  if (modelingChanged) {
    console.log('Modeling bundle changed, clearing module cache')
    clearAllCaches()
  }

  if (bundles) Object.assign(requireCache.bundleAlias, bundles)
  // workspace aliases
  alias.forEach(({ name, path }) => {
    requireCache.alias[name] = path
  })
  console.log('init alias', alias, 'bundles',bundles)
  workerState.userInstances = options.userInstances
  workerState.useParamsProxy = options.useParamsProxy
  workerState.claims = options.claims === true
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
 * @param {{params?:import('@jscadui/format-common').UserParameters,skipLog?:boolean,userInteractedPaths?:string[],useGpuNormals?:boolean,stream?:boolean,runId?:unknown,held?:string[],freshConsole?:boolean}} options
 * @returns {Promise<import('@jscadui/format-common').JscadMainResult>}
 */
export async function jscadMain({ params, skipLog: _skipLog, userInteractedPaths, useGpuNormals, stream = true, runId, held, solidsOnly = false, freshConsole = true } = {}) {
  const myGeneration = workerState.getGeneration()
  const assertFresh = (stage) => {
    if (myGeneration !== workerState.getGeneration()) {
      throw new SupersededError(`jscadMain superseded by newer script ${stage}`)
    }
  }
  // Update GPU normals setting if provided (allows switching without re-running script)
  if (useGpuNormals !== undefined) {
    const modelingBundleUrl = requireCache.bundleAlias['@jscad/modeling']
    if (modelingBundleUrl) {
      let modelingModule
      try {
        modelingModule = require(modelingBundleUrl, null, readFileWeb)
      } catch (err) {
        console.warn('modeling bundle could not be required for GPU normals:', err)
      }
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
  params = {...params}
  const importData = workerState.importData
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

  assertFresh('before run')

  workerState.lastParams = params

  if (workerState.useParamsProxy) workerState.currentUiValues = params

  /** @type {import('@jscadui/format-common').JscadTransferable []} */
  const transferable = []

  if (!workerState.main) throw noMainError()

  let time = performance.now()
  let treeTime = 0
  let execTime = 0
  let convTime = 0

  const heldSet = held === undefined ? undefined : new Set(held)
  // Run main with either proxy or plain params, building the lazy model tree
  // under a per-run build context the measurements read.
  const ctx = createBuildContext()
  const boundEvaluate = loadBoundEvaluate()
  if (boundEvaluate) bindEvaluator(ctx, boundEvaluate)
  // A streamed cell may carry lazy tree nodes (grid placement on the anchored
  // bundles); evaluate them against the live build memo the way the eager
  // measurement seam does, instead of the post-build snapshot below.
  const evaluateStreamed = boundEvaluate
    ? async (nodes) => {
      const live = memoFromSpecials(ctx)
      const solids = []
      const ghosts = []
      for (const node of nodes) {
        const evaluated = await boundEvaluate(node, live)
        solids.push(...evaluated.solids)
        ghosts.push(...evaluated.ghosts)
      }
      return { solids, ghosts }
    }
    : undefined
  const { hook, emitted } = stream
    ? createStreamHook({
      post: (message, transfer) => self.postMessage(message, transfer),
      userInstances: workerState.userInstances,
      runId,
      held: heldSet,
      claim: workerState.claims ? claims.claim : undefined,
      evaluate: evaluateStreamed,
    })
    : { hook: null, emitted: () => false }
  const runMain = (mainParams) => withStreamHook(hook, () => workerState.main(mainParams))

  // A re-run reports only its own lines; jscadScript keeps the top-level ones it just collected.
  if (freshConsole) runConsole?.reset()

  try {
    const buildWith = (mainParams) => withBuildContext(ctx, () => runMain(mainParams))

    let out
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

        out = flatten(await buildWith(proxyParams))
      } else {
        // New hierarchical param system - shared state for nested parts
        proxyState = createProxyState(workerState.currentUiValues, workerState.userInteracted, { mode: 'hierarchical' })
        const proxyParams = createParamsProxy(proxyState)

        out = flatten(await buildWith(proxyParams))
      }
    } else {
      out = flatten(await buildWith(params || {}))
    }

    const root = out
    const parts = splitParts(root)
    const memo = memoFromSpecials(ctx)

    // A root-level ghost belongs to no part, so it is not claimed on its own
    // key with the parts; it streams under one trailing claim instead.
    const rootGhostNodes = []
    const modelParts = []
    for (const part of parts) {
      if (part.nodes.every(isRootGhostNode)) rootGhostNodes.push(...part.nodes)
      else modelParts.push(part)
    }

    assertFresh('after main')

    treeTime = performance.now() - time

    const evaluateRootNode = (node) => boundEvaluate
      ? boundEvaluate(node, memo)
      : Promise.resolve({ solids: node === undefined || node === null ? [] : [node], ghosts: [] })
    const evaluateNodes = async (nodes) => {
      const solids = []
      const ghosts = []
      for (const node of nodes) {
        const evaluated = await evaluateRootNode(node)
        solids.push(...evaluated.solids)
        ghosts.push(...evaluated.ghosts)
      }
      return { solids, ghosts }
    }

    const buildResult = (entities) => {
      const result = { entities, treeTime, execTime, convTime }
      if (globalThis.__allWasmTrap) result.trapped = true
      const warnings = runWarnings?.list() ?? []
      if (warnings.length) result.warnings = warnings
      const consoleLines = runConsole?.list() ?? []
      if (consoleLines.length) result.console = consoleLines

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

      return result
    }

    if (stream) workerState.lastRunStreamed = emitted()

    // Multi-part runs stream through claims: the lone worker wins every claim
    // and evaluates its parts sequentially. Each won part emits its solids
    // batch and, when it has any, a following ghosts batch.
    if (stream && hook && hook.claim && runId !== undefined && modelParts.length > 1) {
      time = performance.now()
      const claimed = []
      for (const part of modelParts) {
        if (!await hook.claim(part.key)) continue
        const { solids, ghosts } = await evaluateNodes(part.nodes)
        claimed.push(...solids)
        // Kept while claiming so the catch below preserves the parts already built.
        workerState.solids = claimed
        await hook.emit(solids)
        if (ghosts.length) await hook.emit(ghosts)
      }
      if (rootGhostNodes.length && await hook.claim(ROOT_GHOST_KEY)) {
        const { solids, ghosts } = await evaluateNodes(rootGhostNodes)
        await hook.emit([...solids, ...ghosts])
      }
      execTime = performance.now() - time

      // Every part went out as it finished; a later export re-runs the model whole.
      workerState.solids = []
      if (stream) workerState.lastRunStreamed = emitted()
      const result = buildResult([])
      Object.assign(result, { streamed: true, runId })
      return withTransferable(result, transferable)
    }

    // Empty, single-part and non-streaming runs produce the whole model as
    // entities, as before; a directly streamed run already emitted its cells.
    let entities = []
    if (emitted()) {
      // Each cell went out as it finished; keeping them would hold the whole grid again
      workerState.solids = []
    } else {
      time = performance.now()
      const { solids: evaluated, ghosts: evaluatedGhosts } = await evaluateNodes([...modelParts.flatMap((part) => part.nodes), ...rootGhostNodes])
      // % and # ghosts are drawn but never exported, so they stay out of solids
      const previewGhosts = evaluated.filter((g) => g?.previewOnly)
      workerState.solids = evaluated.filter((g) => !g?.previewOnly)
      const ghosts = [...evaluatedGhosts, ...previewGhosts]

      // Force evaluation of lazy Manifold geometries
      // This triggers actual CSG computation; result is cached for getMesh()
      for (const solid of workerState.solids) {
        if (solid && solid.isManifoldGeom3) {
          solid.manifold.numTri() // Forces evaluation, caches result
        }
      }
      execTime = performance.now() - time

      // A solidsOnly re-run (an export re-running a streamed grid) reads the
      // solids back out, so the mesh conversion below would build entity
      // arrays only to discard them, at grid-scale memory cost. The
      // evaluation above already warmed the cache the export reads.
      if (!solidsOnly) {
        time = performance.now()
        const prepared = toRefs(JscadToCommon.prepare(ghosts.length ? [...workerState.solids, ...ghosts] : workerState.solids, undefined, workerState.userInstances).all, heldSet, [])
        const copied = withCopies(prepared)
        entities = copied.entities
        transferable.push(...copied.transfer)
        convTime = performance.now() - time
      }
    }

    const result = buildResult(entities)
    if (emitted()) Object.assign(result, { streamed: true, runId })
    return withTransferable(result, transferable)
  } catch (error) {
    if (myGeneration !== workerState.getGeneration()) throw error
    const { lastRunStreamed } = workerState
    const partialStream = emitted()
    const solids = workerState.solids
    workerState.clearGeometry() // M1 fix: Also clear solids array on error to free memory
    // A part whose conversion throws mid-stream already posted earlier parts;
    // keep the solids so the partial model is not lost.
    if (partialStream && solids.length) workerState.solids = solids
    // A failed export re-run must not make later exports read the emptied solids as the model.
    if (!stream) workerState.lastRunStreamed = lastRunStreamed
    // Re-throw with additional context
    const message = error.message || String(error)
    const wrappedError = new Error(`jscadMain failed: ${message}`)
    wrappedError.stack = error.stack
    wrappedError.name = error.name || 'Error'
    throw wrappedError
  } finally {
    // Reuse is by content hash; a cached entity whose buffers were transferred is detached
    JscadToCommon.clearCache()
  }
}

/**
 * A failed load's error carries `output`, the run's console and warnings. A
 * scratch run never throws: its error is part of the answer, since the frame
 * and the app's replay treat a failed load as the loss of the model.
 * @param {{script:string,url?:string,base?:string,root?:string,useGpuNormals?:boolean,runId?:unknown,held?:string[],runMain?:boolean,scratch?:boolean}} param0
 * @returns {Promise<import('@jscadui/format-common').JscadScriptResultWithParams>}
 */
export const jscadScript = async ({ script, url='jscad.js', base=workerState.globalBase, root=base, useGpuNormals: gpuNormals, runId, held, runMain = true, scratch = false }) => {
  // I1 fix: Increment generation to invalidate any timed-out scripts still running
  const myGeneration = workerState.nextGeneration()
  // An ALL.js grid yields between cells and reads this to stop once it is stale
  globalThis.__jscadScriptGeneration = myGeneration

  // Acquire lock to prevent race conditions with concurrent script executions
  const release = await acquireScriptLock()
  let previousModelState = null
  let restoreModel = null
  let cachedProjectModules = null
  try {
    // Check if we're still the current generation after acquiring lock
    // A timeout may have released the lock and allowed another script to start
    if (myGeneration !== workerState.getGeneration()) {
      throw new SupersededError('Script execution superseded by newer script')
    }

    console.log('run script with base:', base, workerState.useParamsProxy ? '(proxy mode)' : '')

    // A scratch run restores all of this instead of running with the
    // current model's param and solid state wiped out from under it.
    previousModelState = {
      main: workerState.main,
      scriptModule: workerState.scriptModule,
      userInteracted: workerState.userInteracted,
      currentUiValues: workerState.currentUiValues,
      legacyProxyDefs: workerState.legacyProxyDefs,
      solids: workerState.solids,
      lastRunStreamed: workerState.lastRunStreamed,
    }

    // Reset proxy state for new script
    workerState.userInteracted = new Set()
    workerState.currentUiValues = {}
    workerState.legacyProxyDefs = null
    workerState.solids = [] // C2 fix: Clear solids array to prevent memory leak on script reload
    workerState.lastRunStreamed = false

    // Top-level model code runs during the require below.
    runWarnings?.reset()
    runConsole?.reset()
    restoreModel = isolateModel?.() ?? null
    // The project modules a scratch run loads must not stay cached for the next build.
    if (scratch) cachedProjectModules = { ...requireCache.local }

    if(!script) script = readFileWeb(resolveUrl(url, base, root).url)

    const transform = shouldTransform(url, script)
    let def = []

    try{
      // A snippet that calls a project file's main() hands it values, which that main gets as a build's params would carry them.
      const wrapRequire = scratch ? withProjectMains : undefined
      const loadedModule = require({url,script,wrapRequire}, transform ? workerState.transformFunc : undefined, readFileWeb, base, root, workerState.importData)
      // Check generation before setting shared state
      if (myGeneration !== workerState.getGeneration()) {
        throw new SupersededError('Script execution superseded by newer script during module load')
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
      // require() returns the live cached bundle, so wait on its ready before
      // user code runs; skipping this await left "Manifold WASM not
      // initialized" errors on cold loads.
      let modelingModule
      try {
        modelingModule = require(modelingBundleUrl, null, readFileWeb)
      } catch (err) {
        console.warn('modeling bundle could not be required; WASM may not be ready:', err)
      }
      if (modelingModule?.ready instanceof Promise) await modelingModule.ready
      if (gpuNormals !== undefined && modelingModule?.setUseGpuNormals) modelingModule.setUseGpuNormals(gpuNormals)
    }

    // Check generation after async WASM init to prevent a stale script from corrupting main
    if (myGeneration !== workerState.getGeneration()) {
      throw new SupersededError('Script execution superseded during WASM initialization')
    }

    workerState.main = workerState.scriptModule.main
    // if the main function is the default export
    if(!workerState.main && typeof workerState.scriptModule == 'function') workerState.main = workerState.scriptModule

    // Check if script has legacy getParameterDefinitions and convert them.
    // Doesn't need main to run, so a runMain:false load leaves this set too.
    if (workerState.useParamsProxy) {
      const legacyDefs = await workerState.scriptModule.getParameterDefinitions?.()
      if (legacyDefs && legacyDefs.length > 0) {
        workerState.legacyProxyDefs = convertLegacyDefs(legacyDefs)
      }
    }

    // Promotion loads the spare with the last script ahead of time, without running main
    if (!runMain) return { def: [], params: {} }

    if (scratch) {
      const hasMain = typeof workerState.main === 'function'
      const value = hasMain ? await workerState.main(scratchParams()) : workerState.scriptModule
      const summary = runSummary?.({ hasMain, value }) ?? {}
      return { def: [], params: {}, scratch: true, ...runOutput(), ...summary }
    }

    if (!workerState.main) throw noMainError()

    let params = {}
    if (workerState.useParamsProxy) {
      // In proxy mode, run main to discover params, then extract defaults
      const out = await jscadMain({ params: {}, runId, held, freshConsole: false })
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
      def = combineParameterDefinitions(fromSource, await workerState.scriptModule.getParameterDefinitions?.())
      params = extractDefaults(def)
      const out = await jscadMain({ params, runId, held, freshConsole: false })
      return {
        def,
        params,
        ...out,
      }
    }
  } catch (error) {
    if (scratch) {
      const failure = { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack }
      return { def: [], params: {}, scratch: true, error: failure, ...runOutput() }
    }
    if (error && typeof error === 'object') error.output = runOutput()
    throw error
  } finally {
    if (scratch && previousModelState) Object.assign(workerState, previousModelState)
    if (scratch) restoreModel?.()
    if (cachedProjectModules) {
      for (const key of Object.keys(requireCache.local)) delete requireCache.local[key]
      Object.assign(requireCache.local, cachedProjectModules)
    }
    release()
  }
}

// A scratch run's main sees only its own defaults, never the model's param state.
const scratchParams = () =>
  workerState.useParamsProxy ? createParamsProxy(createProxyState({}, new Set(), { mode: 'hierarchical' })) : {}

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

export const currentParams = () => workerState.lastParams

export const lastRunStreamed = () => workerState.lastRunStreamed

export const postProgress = () => self.postMessage({ method: 'jscadProgress', params: [] })

export const releaseSolids = () => { workerState.solids = [] }

const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache:clearFileCache, jscadExportData, __CLAIM__: answerClaim }
// SECURITY NOTE (FALSE POSITIVE): Intentional dynamic code loading - JSCAD is a script playground.
// User scripts are evaled via require() and their exports exposed below, all inside an
// isolated Worker context with no DOM access. Executing user-provided modeling scripts
// is fundamental to the app's purpose. This is by design.
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


