/**
 * Compute frame setup: the sandboxed frame is the only place model code runs.
 */

import { messageProxy } from '@jscadui/postmessage'
import { framePort } from './framePort.js'

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

/**
 * The compute frame stands in for the local worker. sandbox without
 * allow-same-origin gives it an opaque origin: model code runs with no
 * cookies, no storage and no same-origin fetch.
 * @param {object} options
 * @param {(error: unknown) => void} options.onError
 * @param {(value?: number) => void} options.onProgress
 * @param {(result: unknown, options: {skipLog?: boolean}) => void} options.onEntities
 * @param {(jobs: number) => void} options.onJobCount
 * @param {() => void} [options.onTerminated] - the frame killed its worker; re-init it
 * @param {string} options.runOrigin
 * @returns {Promise<{frameEl: HTMLIFrameElement, workerApi: JscadWorker, handlers: object}>}
 */
export const createFrame = async ({ onError, onProgress, onEntities, onJobCount, onTerminated, runOrigin }) => {
  const frameEl = document.createElement('iframe')
  frameEl.src = runOrigin + '/'
  frameEl.setAttribute('sandbox', 'allow-scripts')
  frameEl.hidden = true
  // A message sent before the frame document runs is lost, and nothing in the
  // protocol replays it.
  const ready = new Promise((resolve) => frameEl.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frameEl)
  await ready

  const handlers = {
    /**
     * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
     * @param {{skipLog?:boolean }} options
     */
    entities: (result, options = {}) => {
      onEntities(result, options)
    },
    onProgress,
    frameWorkerTerminated: ({ reason }) => {
      onError(new Error(reason))
      onTerminated?.()
    },
  }

  const workerApi = /** @type {JscadWorker} */ (messageProxy(framePort(frameEl, runOrigin), handlers, { onJobCount }))

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
