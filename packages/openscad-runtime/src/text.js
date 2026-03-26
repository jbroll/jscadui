/**
 * OpenSCAD text() primitive runtime implementation.
 *
 * Bridges OpenSCAD's text() builtin to @jscadui/jscad-text.
 * Returns geom2 synchronously for all font sources:
 *   - Hershey (default): built-in, no I/O
 *   - TTF file path (Node.js): opentype.loadSync() → readFileSync
 *   - TTF URL (browser Web Worker): sync XMLHttpRequest
 *   - ArrayBuffer/Uint8Array: parsed directly
 *   - TTF HTTP URL in Node.js: pre-load with await fontLoader.load(url) first
 */

import { _getSegments } from './segments.js'
import { text2d, init as initJscadText } from '@jscadui/jscad-text'

let jscad = null
let textInitDone = false

export const initText = (jscadRef) => {
  jscad = jscadRef
}

/**
 * OpenSCAD text() runtime function (synchronous).
 *
 * Defaults to Liberation Sans (the same TrueType font OpenSCAD uses) for correct
 * geometric output. The font is loaded synchronously:
 *   - Node.js: bundled LiberationSans-Regular.ttf (file path, always works)
 *   - Browser Web Worker: sync XHR to CDN URL (explicitly allowed in workers)
 */
export const _text = ({
  text = '',
  size = 10,
  font = 'Liberation Sans',
  halign = 'left',
  valign = 'baseline',
  spacing = 1,
  direction = 'ltr',
  $fn,
  $fa,
  $fs,
} = {}) => {
  if (!text) return null

  const fn = $fn ?? _getSegments(size / 2, $fn, $fa, $fs)

  // Initialize jscad-text with jscad instance (once per runtime)
  if (!textInitDone && jscad) {
    initJscadText(jscad)
    textInitDone = true
  }

  try {
    return text2d({
      text,
      size,
      font,
      halign,
      valign,
      spacing,
      direction,
      $fn: fn,
    })
  } catch (e) {
    // Font not available (missing system font, custom font, etc.) — return null
    // so callers can treat it as empty geometry rather than crashing
    console.warn(`text(): font not available: ${e.message}`)
    return null
  }
}
