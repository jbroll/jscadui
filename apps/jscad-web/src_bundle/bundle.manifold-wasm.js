/**
 * Manifold WASM bundle - loads manifold-3d and exposes it as a global.
 *
 * This is loaded as an IIFE script before the worker, making the Manifold
 * module available globally.
 */

import Module from 'manifold-3d'

// Initialize and expose globally
let wasmModule = null
let initPromise = null

const initManifold = async () => {
  if (wasmModule) return wasmModule
  if (initPromise) return initPromise

  initPromise = (async () => {
    wasmModule = await Module()
    wasmModule.setup()
    return wasmModule
  })()

  return initPromise
}

const getManifoldModule = () => {
  if (!wasmModule) throw new Error('Manifold not initialized')
  return wasmModule
}

const isManifoldInitialized = () => wasmModule !== null

// Expose globally for the worker
globalThis.ManifoldWASM = {
  init: initManifold,
  getModule: getManifoldModule,
  isInitialized: isManifoldInitialized
}
