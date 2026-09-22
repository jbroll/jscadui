import { createFrameHost } from './frameHost.js'

// Injected by esbuild at build time (see build.js).
const ALLOWED_ORIGIN = __ALLOWED_ORIGIN__

const BUNDLE_BASE = new URL('./assets/', location.href).href

// A sandboxed frame has an opaque origin, so new Worker(url) throws and the
// worker must come from a blob that importScripts the real bundle. Relative
// importScripts fail inside a blob worker, so the bundle base is baked in.
const workerSource =
  `self.__BUNDLE_BASE__ = ${JSON.stringify(BUNDLE_BASE)}\n` +
  `importScripts(${JSON.stringify(BUNDLE_BASE + 'bundle.frame-worker.js')})`

const { handleMessage } = createFrameHost({
  allowedOrigin: ALLOWED_ORIGIN,
  bundleBase: BUNDLE_BASE,
  createWorker: () =>
    new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }))),
  post: (message, transfer) => parent.postMessage(message, ALLOWED_ORIGIN, transfer),
  parentWindow: parent,
})

window.addEventListener('message', handleMessage)
