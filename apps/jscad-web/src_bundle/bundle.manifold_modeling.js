/**
 * Bundle export for @jscadui/manifold
 *
 * This provides a drop-in replacement for @jscad/modeling using Manifold
 * for guaranteed watertight boolean operations.
 */

import { setWasmUrl, startInit } from '@jscadui/manifold'
import { bundleFileUrl } from './bundleBase.js'

// The wasm sits next to this bundle. In the compute frame's blob worker
// location.href is an opaque blob: URL, so the base comes from __BUNDLE_BASE__.
setWasmUrl(bundleFileUrl('./manifold.wasm', self))

// Start initialization - ready promise will be available
startInit()

// Re-export everything
export * from '@jscadui/manifold'
