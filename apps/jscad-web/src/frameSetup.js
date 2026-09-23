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
 * What a worker needs to be the one the app last set up: the inits, the file
 * map, the script and the params of the last run. A fresh worker, after a
 * timeout kill or a frame reload, gets these replayed before any new request,
 * so a parameter change or an export runs against the model on screen.
 * @param {Record<string, (...args: unknown[]) => Promise<unknown>>} proxy
 */
const createReplay = (proxy) => {
  let engineInit = null
  let lastInit = null
  const aliasInits = new Map()
  let files = null
  let script = null
  let main = null
  let restoring = null
  // The worker lost a model it could not get back. Without this an export
  // would serialize the fresh worker's empty scene and report success.
  let lost = false

  const succeeded = {
    jscadInit: (args) => {
      const [options = {}] = args
      if (options.engine) engineInit = args
      if (options.alias) aliasInits.set(JSON.stringify(options.alias), args)
      lastInit = args
    },
    jscadSetFiles: (args) => { files = args },
    jscadScript: (args) => { script = args; main = null; lost = false },
    jscadMain: (args) => { main = args },
  }

  let everLoaded = false
  // A worker that never finished an init still needs its bundles named, so
  // until one succeeds the replay retries the last one attempted.
  let attemptedEngineInit = null

  const record = (method, args, result) => {
    const onSuccess = succeeded[method]
    if (!onSuccess) return
    if (method === 'jscadScript') everLoaded = true
    if (method === 'jscadInit' && args[0]?.engine) attemptedEngineInit = args
    result.then(() => onSuccess(args), () => {
      if (method === 'jscadScript') script = main = null
    })
  }

  // A replay request answered by a kill means the frame's frameWorkerTerminated
  // for that kill is on its way. Replaying on it would restart the loop with no
  // request of the app's behind it, so that one restart is skipped.
  let skipRestart = false

  const replay = async () => {
    try {
      const inits = [...new Set([engineInit ?? attemptedEngineInit, ...aliasInits.values(), lastInit])].filter(Boolean)
      for (const args of inits) await proxy.jscadInit(...args)
      if (files) await proxy.jscadSetFiles(...files)
      if (!script) {
        lost = everLoaded
        return
      }
      await proxy.jscadScript(...script)
      if (main) await proxy.jscadMain(...main)
    } catch (error) {
      script = main = null
      lost = everLoaded
      skipRestart = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    }
  }

  const needsModel = new Set(['jscadMain', 'jscadExportData', 'jscadMeasure', 'jscadCheck'])

  return {
    record,
    // A restart during a replay is the replay's own doing: its calls fail, so
    // it ends without the model rather than starting over.
    restore: () => {
      if (skipRestart) {
        skipRestart = false
        return
      }
      if (restoring) return
      restoring = replay().finally(() => { restoring = null })
    },
    /**
     * @param {string} method
     * @param {() => Promise<unknown>} send
     */
    gate: (method, send) => {
      const checked = () => lost && needsModel.has(method)
        ? Promise.reject(new Error('the model stopped and could not be reloaded; run it again'))
        : send()
      return restoring ? restoring.then(checked) : checked()
    },
  }
}

/**
 * The compute frame stands in for the local worker. sandbox without
 * allow-same-origin gives it an opaque origin: model code runs with no
 * cookies, no storage and no same-origin fetch.
 * @param {object} options
 * @param {(error: unknown) => void} options.onError
 * @param {(result: unknown, options: {skipLog?: boolean}) => void} options.onEntities
 * @param {(jobs: number) => void} options.onJobCount
 * @param {() => void} [options.onTerminated] - the frame lost its worker; the replay already re-inits it
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
      replay.restore()
      onTerminated?.()
    },
  }

  const proxy = messageProxy(framePort(frameEl, runOrigin), notifications, { onJobCount })
  const replay = createReplay(proxy)

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
      replay.restore()
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
      if (PASS_THROUGH.has(prop) || typeof prop !== 'string') return target[prop]
      if (!loaded) return () => Promise.reject(notLoaded())
      return (...args) => replay.gate(prop, () => {
        const result = target[prop](...args)
        replay.record(prop, args, result)
        return result
      })
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
