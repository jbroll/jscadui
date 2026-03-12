#!/usr/bin/env node
/**
 * Download Liberation fonts to the local cache (~/.cache/jscadui/fonts/).
 *
 * Run once before using text() in corpus tests with non-default fonts:
 *   node packages/openscad/bin/download-fonts.js
 *
 * After running, run-jscad.js and test-harness.js will automatically use
 * the cached fonts instead of making CDN requests.
 */

import { ensureLiberationFonts, DEFAULT_CACHE_DIR } from '../../jscad-text/src/fonts/fontCache.js'

console.log(`Font cache: ${DEFAULT_CACHE_DIR}`)

const { downloaded, cached } = await ensureLiberationFonts()

if (downloaded.length > 0) {
  console.log(`Downloaded ${downloaded.length} fonts:`)
  for (const f of downloaded) console.log(`  + ${f}`)
}
if (cached.length > 0) {
  console.log(`Already cached: ${cached.length} fonts`)
}
console.log('Done.')
