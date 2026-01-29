/**
 * Bundle export for @jscadui/manifold
 *
 * This provides a drop-in replacement for @jscad/modeling using Manifold
 * for guaranteed watertight boolean operations.
 */

import { setWasmUrl, startInit } from '@jscadui/manifold'

// Configure WASM URL before initialization
// The WASM file is served alongside the bundle
const wasmUrl = new URL('./manifold.wasm', self.location.href).href
setWasmUrl(wasmUrl)

// Start initialization - ready promise will be available
startInit()

// Re-export everything
export * from '@jscadui/manifold'
