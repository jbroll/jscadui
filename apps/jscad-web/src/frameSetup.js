/**
 * Compute frame setup: the sandboxed frame is the only place model code runs.
 */

import { messageProxy } from '@jscadui/postmessage'
import { framePort } from './framePort.js'

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

// Not RPC methods, so they answer normally whether or not the frame loaded.
// 'then' matters: manufacturing one would make the proxy look like a promise.
const PASS_THROUGH = new Set(['then', 'destroy', 'onmessage', 'getRpcJobCount'])

/**
 * The compute frame stands in for the local worker. sandbox without
 * allow-same-origin gives it an opaque origin: model code runs with no
 * cookies, no storage and no same-origin fetch.
 * @param {object} options
 * @param {(error: unknown) => void} options.onError
 * @param {(result: unknown, options: {skipLog?: boolean}) => void} options.onEntities
 * @param {(jobs: number) => void} options.onJobCount
 * @param {() => void} [options.onTerminated] - the frame killed its worker; re-init it
 * @param {string} options.runOrigin
 * @param {number} [options.loadTimeoutMs]
 * @returns {Promise<{frameEl: HTMLIFrameElement, workerApi: JscadWorker, handlers: object}>}
 */
export const createFrame = async ({ onError, onEntities, onJobCount, onTerminated, runOrigin, loadTimeoutMs = 15000 }) => {
  const frameEl = document.createElement('iframe')
  frameEl.src = runOrigin + '/'
  frameEl.setAttribute('sandbox', 'allow-scripts')
  frameEl.hidden = true

  // The worker answers jscadMain with its entities rather than notifying, so
  // frameWorkerTerminated is the only message the frame sends on its own.
  const notifications = {
    frameWorkerTerminated: ({ reason }) => {
      onError(new Error(reason))
      onTerminated?.()
    },
  }

  const proxy = messageProxy(framePort(frameEl, runOrigin), notifications, { onJobCount })

  // A message sent before the frame document runs is lost, and nothing in the
  // protocol replays it. An extension, a proxy or DNS can keep that load from
  // ever arriving, so boot goes on without it rather than stopping the page.
  let loaded = false
  let timer
  const ready = new Promise((resolve) => frameEl.addEventListener('load', () => {
    if (loaded) {
      // A second load means the frame navigated. Its worker, file map and
      // engine went with it, so every later request would run against a frame
      // the app never set up, and no request in flight will be answered.
      const error = new Error(`compute frame at ${runOrigin} reloaded; its state is gone`)
      proxy.rejectPending(error)
      onError(error)
      onTerminated?.()
      return
    }
    loaded = true
    resolve(undefined)
  }))
  const notLoaded = () =>
    new Error(`compute frame at ${runOrigin} did not load within ${loadTimeoutMs} ms; models cannot run`)
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      onError(notLoaded())
      resolve(undefined)
    }, loadTimeoutMs)
  })
  document.body.appendChild(frameEl)
  await Promise.race([ready, deadline])
  clearTimeout(timer)

  // Not messages: main.js's own sink for whatever produced geometry, called
  // directly for restores and cached results as well as for a fresh render.
  const handlers = {
    ...notifications,
    /**
     * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
     * @param {{skipLog?:boolean }} options
     */
    entities: (result, options = {}) => {
      onEntities(result, options)
    },
  }

  // A frame that never loaded cannot answer, and the message proxy would wait
  // out its five-minute default to find that out — long enough to stall the
  // boot path, which awaits jscadInit and the export format list. Reject the
  // call instead, and go back to relaying if a slow frame does turn up.
  const workerApi = /** @type {JscadWorker} */ (new Proxy(proxy, {
    get: (target, prop) => {
      if (loaded || PASS_THROUGH.has(prop) || typeof prop !== 'string') return target[prop]
      return () => Promise.reject(notLoaded())
    },
  }))

  return { frameEl, workerApi, handlers }
}

/**
 * Create a job tracker for showing/hiding progress bar
 * @param {HTMLProgressElement} progress - The progress element
 * @param {(value?: number) => void} onProgress - Progress handler
 * @returns {(jobs: number) => void}
 */
export function createJobTracker(progress, onProgress) {
  /** @type {NodeJS.Timeout} */
  let firstJobTimer

  return (jobs) => {
    if (jobs === 1) {
      // Do not show progress for fast renders
      clearTimeout(firstJobTimer)
      firstJobTimer = setTimeout(() => {
        onProgress()
        progress.style.display = 'block'
      }, 300)
    }
    if (jobs === 0) {
      clearTimeout(firstJobTimer)
      progress.style.display = 'none'
    }
  }
}
