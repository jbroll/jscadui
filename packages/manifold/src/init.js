/**
 * Manifold WASM initialization module.
 *
 * Provides singleton initialization of the Manifold WASM module.
 * Auto-initializes when the module is loaded for seamless bundle usage.
 *
 * Usage:
 * - Import and await `ready` before using any Manifold operations
 * - Or check `isInitialized()` to verify WASM is ready
 */

let wasmModule = null
let initPromise = null

// Default WASM URL - can be overridden with setWasmUrl before init
let wasmUrl = null

/**
 * Set the URL for the manifold.wasm file.
 * Must be called before init() or any operations.
 *
 * @param {string} url - URL to the manifold.wasm file
 */
export const setWasmUrl = (url) => {
  wasmUrl = url
}

/**
 * Initialize the Manifold WASM module.
 * Safe to call multiple times - will return cached module.
 *
 * @returns {Promise<Object>} The initialized WASM module with Manifold classes
 */
export const init = async () => {
  if (wasmModule) {
    return wasmModule
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const Module = (await import('manifold-3d')).default
    // Use provided WASM URL or let the module find it
    const config = wasmUrl ? { locateFile: () => wasmUrl } : undefined
    wasmModule = await Module(config)
    wasmModule.setup()
    return wasmModule
  })()

  return initPromise
}

// Note: We don't auto-start init() here because setWasmUrl() must be called first
// in bundled environments. The bundle entry point handles initialization.

/**
 * Promise that resolves when WASM is ready.
 * This is set by the first call to init().
 *
 * @type {Promise<Object>|null}
 */
export let ready = null

/**
 * Start initialization and set up the ready promise.
 * Call this after setWasmUrl() if needed.
 */
export const startInit = () => {
  if (!ready) {
    ready = init()
  }
  return ready
}

/**
 * Get the initialized WASM module.
 * Throws if init() hasn't completed.
 *
 * @returns {Object} The WASM module
 * @throws {Error} If module not initialized
 */
export const getModule = () => {
  if (!wasmModule) {
    throw new Error('Manifold WASM not initialized. Await the "ready" export before using Manifold operations.')
  }
  return wasmModule
}

/**
 * Get the Manifold class from the initialized module.
 *
 * @returns {Object} The Manifold class
 */
export const getManifold = () => getModule().Manifold

/**
 * Get the CrossSection class from the initialized module.
 *
 * @returns {Object} The CrossSection class for 2D operations
 */
export const getCrossSection = () => getModule().CrossSection

/**
 * Check if the module is initialized.
 *
 * @returns {boolean} True if initialized
 */
export const isInitialized = () => wasmModule !== null

export default { init, ready, getModule, getManifold, getCrossSection, isInitialized }
