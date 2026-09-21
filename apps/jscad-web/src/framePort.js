/**
 * A Worker-shaped port over a cross-origin iframe, so messageProxy can drive
 * the compute frame the way it drives a worker.
 *
 * The frame's document is sandboxed without allow-same-origin, so it reports
 * event.origin 'null' and no explicit targetOrigin can match it on the way in.
 * Identity of the frame's window is the only check this side can make; the
 * frame's own allowedOrigin check is what keeps strangers out.
 * @param {HTMLIFrameElement} iframe
 * @param {string} runOrigin
 * @param {{addEventListener:Function,removeEventListener:Function}} [host]
 */
export const framePort = (iframe, runOrigin, host = window) => {
  // Catch a misconfigured build where the iframe src and the baked run origin
  // disagree; nothing downstream can tell the two apart.
  if (new URL(iframe.src).origin !== runOrigin) {
    throw new Error(`frame src ${iframe.src} does not match origin ${runOrigin}`)
  }

  const wrapped = new Map()
  return {
    postMessage: (message, transfer = []) => iframe.contentWindow.postMessage(message, '*', transfer),
    addEventListener: (type, fn) => {
      const filtered = (event) => {
        if (event.source !== iframe.contentWindow) return
        fn(event)
      }
      wrapped.set(fn, filtered)
      host.addEventListener(type, filtered)
    },
    removeEventListener: (type, fn) => {
      const filtered = wrapped.get(fn)
      if (!filtered) return
      wrapped.delete(fn)
      host.removeEventListener(type, filtered)
    },
  }
}
