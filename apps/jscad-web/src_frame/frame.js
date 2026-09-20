import { messageProxy } from '@jscadui/postmessage'
import { PROJECT_BASE } from './fileMap.js'

// Injected by esbuild at build time (see build.js).
const ALLOWED_ORIGIN = __ALLOWED_ORIGIN__

const BUNDLE_BASE = new URL('./build/', location.href).href

const DEFAULT_TIMEOUT_MS = 30000

// A sandboxed frame has an opaque origin, so new Worker(url) throws and the
// worker must come from a blob that importScripts the real bundle. Relative
// importScripts fail inside a blob worker, so the bundle base is baked in.
const workerSource =
  `self.__BUNDLE_BASE__ = ${JSON.stringify(BUNDLE_BASE)}\n` +
  `importScripts(${JSON.stringify(BUNDLE_BASE + 'bundle.frame-worker.js')})`

// The worker is recreated after a timeout killed the previous one.
const createWorker = () => {
  const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' })))
  return { worker, workerApi: messageProxy(worker, {}) }
}

let { worker, workerApi } = createWorker()

// The manifold build layers on the plain modeling bundle, so only the name
// model code requires switches; '@jscad/modeling-for-manifold' stays put.
const workerBundles = (engine) => ({
  '@jscad/modeling': BUNDLE_BASE + (engine === 'manifold' ? 'bundle.manifold_modeling.js' : 'bundle.jscad_modeling.js'),
  '@jscad/modeling-for-anchors': BUNDLE_BASE + (engine === 'manifold' ? 'bundle.manifold_modeling.js' : 'bundle.jscad_modeling.js'),
  '@jscad/modeling-for-manifold': BUNDLE_BASE + 'bundle.jscad_modeling.js',
  '@jscad/io': BUNDLE_BASE + 'bundle.jscad_io.js',
  '@jscadui/model-tools': BUNDLE_BASE + 'bundle.model-tools.js',
  '@jbroll/jscad-fluent': BUNDLE_BASE + 'bundle.jscad-fluent.js',
  '@jscadui/params-core': BUNDLE_BASE + 'bundle.params_core.js',
  '@jscadui/jscad-text': BUNDLE_BASE + 'bundle.jscad_text.js',
})

// Collect the ArrayBuffers behind every typed array in a result so they can
// cross to the app zero-copy. The worker already transferred them once.
const collectBuffers = (value, out = [], seen = new Set()) => {
  if (value === null || typeof value !== 'object') return out
  if (seen.has(value)) return out
  seen.add(value)
  if (ArrayBuffer.isView(value)) {
    if (!seen.has(value.buffer)) {
      seen.add(value.buffer)
      out.push(value.buffer)
    }
    return out
  }
  for (const v of Object.values(value)) collectBuffers(v, out, seen)
  return out
}

const commands = {
  async load({ files, entry, engine }) {
    await workerApi.jscadInit({ bundles: workerBundles(engine), useParamsProxy: true })
    await workerApi.jscadSetFiles({ files })
    const result = await workerApi.jscadScript({
      script: files[entry],
      url: PROJECT_BASE + entry,
      base: PROJECT_BASE,
      root: PROJECT_BASE,
    })
    return {
      result: { params: result.params, entities: result.entities, proxyState: result.proxyState },
      transfer: collectBuffers(result),
    }
  },
  async params({ values }) {
    const result = await workerApi.jscadMain({
      params: values,
      // The proxy only returns a value the user has interacted with; every
      // value the app sends is one the user changed.
      userInteractedPaths: Object.keys(values),
    })
    return { result: { entities: result.entities }, transfer: collectBuffers(result) }
  },
  async measure({ options }) {
    return { result: await workerApi.jscadMeasure({ options }) }
  },
  async check({ bed, options }) {
    return { result: await workerApi.jscadCheck({ bed, options }) }
  },
  async export({ format, options }) {
    const { data = [] } = await workerApi.jscadExportData({ format, options })
    return {
      result: { data },
      transfer: data.map((v) => (ArrayBuffer.isView(v) ? v.buffer : v)).filter((v) => v instanceof ArrayBuffer),
    }
  },
}

window.addEventListener('message', async (event) => {
  if (event.origin !== ALLOWED_ORIGIN) return
  const { id, command } = event.data
  const payload = event.data.payload ?? {}
  if (!id || !commands[command]) return
  // A timed-out command may have left the worker stuck; the next command gets
  // a fresh one.
  if (!worker) ({ worker, workerApi } = createWorker())
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = payload
  let timer
  try {
    const work = commands[command](payload)
    // The race may already have answered a timeout; swallow the late rejection.
    work.catch(() => {})
    const { result, transfer } = await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`command ${command} timed out after ${timeoutMs} ms`)
          error.name = 'TimeoutError'
          reject(error)
        }, timeoutMs)
      }),
    ])
    clearTimeout(timer)
    event.source.postMessage({ id, ok: true, result }, ALLOWED_ORIGIN, transfer)
  } catch (error) {
    clearTimeout(timer)
    if (error.name === 'TimeoutError') {
      worker.terminate()
      worker = null
    }
    event.source.postMessage(
      { id, ok: false, error: { message: error.message, name: error.name, stack: error.stack } },
      ALLOWED_ORIGIN,
    )
  }
})