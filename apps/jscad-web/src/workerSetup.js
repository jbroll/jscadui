/**
 * Worker setup module
 * Handles Web Worker creation, error handling, and message proxy setup
 */

import { messageProxy } from '@jscadui/postmessage'

/**
 * @typedef {import('@jscadui/worker').JscadWorker} JscadWorker
 */

/**
 * Create and configure the JSCAD worker
 * @param {object} options
 * @param {(error: Error) => void} options.onError - Error handler
 * @param {(value?: number) => void} options.onProgress - Progress handler
 * @param {(entities: unknown[], stats: object) => void} options.onEntities - Entities handler
 * @param {(jobs: number) => void} options.onJobCount - Job count handler
 * @returns {{ worker: Worker, workerApi: JscadWorker, handlers: object }}
 */
export function createWorker({ onError, onProgress, onEntities, onJobCount }) {
  const worker = new Worker('./build/bundle.worker.js')

  // Handle worker errors that would otherwise be silent
  worker.onerror = (event) => {
    console.error('Worker error:', event.message, event.filename, event.lineno)
    onError(new Error(`Worker error: ${event.message}`))
  }

  // Handle message deserialization errors
  worker.onmessageerror = (event) => {
    console.error('Worker message error:', event)
    onError(new Error('Failed to deserialize worker message'))
  }

  const handlers = {
    /**
     * @param {{entities:unknown | Array<unknown>,treeTime:number,execTime:number,convTime:number}} result
     * @param {{skipLog?:boolean }} options
     */
    entities: (result, options = {}) => {
      onEntities(result, options)
    },
    onProgress,
  }

  const workerApi = /** @type {JscadWorker} */ (messageProxy(worker, handlers, { onJobCount }))

  return { worker, workerApi, handlers }
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
