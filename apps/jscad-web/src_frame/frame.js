import { collectBuffers } from './collectBuffers.js'

// Injected by esbuild at build time (see build.js).
const ALLOWED_ORIGIN = __ALLOWED_ORIGIN__

const BUNDLE_BASE = new URL('./build/', location.href).href

const DEFAULT_TIMEOUT_MS = 30000

const RESPONSE = '__RESPONSE__'

// A sandboxed frame has an opaque origin, so new Worker(url) throws and the
// worker must come from a blob that importScripts the real bundle. Relative
// importScripts fail inside a blob worker, so the bundle base is baked in.
const workerSource =
  `self.__BUNDLE_BASE__ = ${JSON.stringify(BUNDLE_BASE)}\n` +
  `importScripts(${JSON.stringify(BUNDLE_BASE + 'bundle.frame-worker.js')})`

const createWorker = () =>
  new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' })))

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

const post = (message, transfer) => parent.postMessage(message, ALLOWED_ORIGIN, transfer)

let engine
let timeoutMs = DEFAULT_TIMEOUT_MS
let pendingId = null
let timer

const armTimeout = (id) => {
  clearTimeout(timer)
  pendingId = id
  timer = setTimeout(() => {
    pendingId = null
    worker.terminate()
    worker = null
    const reason = `model exceeded ${timeoutMs} ms`
    // The killed worker will never answer, so the frame answers for it: the
    // caller's promise must reject now, not at the proxy's own 5-minute timeout.
    post({ method: RESPONSE, id, error: { name: 'TimeoutError', message: reason } })
    post({ method: 'frameWorkerTerminated', params: [{ reason }] })
  }, timeoutMs)
}

let worker
// A timed-out request left the worker stuck, so it was killed; the next
// request gets a fresh one.
const attach = () => {
  worker = createWorker()
  worker.onmessage = (event) => {
    const { method, id } = event.data
    if (method === RESPONSE && id === pendingId) {
      clearTimeout(timer)
      pendingId = null
    }
    post(event.data, collectBuffers(event.data))
  }
}
attach()

// The one method that is not relayed untouched. A script source inside the
// frame must come from the frame's own origin, so the app names an engine and
// the frame names the bundles.
const frameInit = (data) => {
  const [options = {}, ...rest] = data.params ?? []
  const { engine: wanted, timeoutMs: wantedTimeout, ...init } = options
  if (wanted) engine = wanted
  if (wantedTimeout) timeoutMs = wantedTimeout
  return { ...data, params: [{ ...init, bundles: workerBundles(engine) }, ...rest] }
}

window.addEventListener('message', (event) => {
  if (event.origin !== ALLOWED_ORIGIN) return
  if (!worker) attach()
  const message = event.data?.method === 'jscadInit' ? frameInit(event.data) : event.data
  if (event.data?.id) armTimeout(event.data.id)
  worker.postMessage(message, collectBuffers(message))
})
