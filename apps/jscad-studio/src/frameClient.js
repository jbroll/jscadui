// The app's half of the compute-frame protocol: { id, command, payload } →
// { id, ok: true, result } / { id, ok: false, error }. A model error is a
// resolved result, never a rejection, so callers check `ok`.
const DEFAULT_TIMEOUT_MS = 60000

/**
 * @param {HTMLIFrameElement} iframe
 * @param {string} origin
 * @returns {{load:(payload:object)=>Promise<object>,params:(payload:object)=>Promise<object>,measure:(payload:object)=>Promise<object>,check:(payload:object)=>Promise<object>,export:(payload:object)=>Promise<object>}}
 */
export const frameClient = (iframe, origin) => {
  // The frame's document has an opaque origin, so the only origin its window
  // reports is 'null'; catch a misconfigured build where the iframe src and
  // the baked run origin disagree.
  if (new URL(iframe.src).origin !== origin) {
    throw new Error(`frame src ${iframe.src} does not match origin ${origin}`)
  }

  let nextId = 1
  /** @type {Map<number,{resolve:(value:object)=>void,timer:ReturnType<typeof setTimeout>}>} */
  const pending = new Map()

  // index.html attaches a load-event promise at parse time, before main.js
  // evaluates; fall back to attaching here when the page does not provide it.
  const ready = window.__frameReady instanceof Promise
    ? window.__frameReady
    : new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }))

  window.addEventListener('message', (event) => {
    // The sandboxed frame's messages carry event.origin 'null', so its window
    // identity is the only check that works across the boundary.
    if (event.source !== iframe.contentWindow) return
    const { id, ok, result, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.resolve(ok ? { id, ok: true, result } : { id, ok: false, error })
  })

  const send = async (command, payload) => {
    const id = nextId++
    await ready
    return new Promise((resolve, reject) => {
      // The frame answers a command over its own timeout; this timer only
      // guards against a frame that never answers at all.
      const clientTimeout = (payload?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10000
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`frame command ${command} timed out`))
      }, clientTimeout)
      pending.set(id, { resolve, timer })
      // The frame's opaque origin never matches an explicit targetOrigin, so
      // post to '*' and let the frame's own origin check reject strangers.
      iframe.contentWindow.postMessage({ id, command, payload }, '*')
    })
  }

  const load = (payload) => send('load', payload)
  const params = (payload) => send('params', payload)
  const measure = (payload) => send('measure', payload)
  const check = (payload) => send('check', payload)
  const exportModel = (payload) => send('export', payload)

  return { load, params, measure, check, export: exportModel }
}