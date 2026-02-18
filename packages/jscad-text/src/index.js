/**
 * @jscadui/jscad-text
 *
 * Text rendering for JSCAD with OpenSCAD-compatible semantics.
 *
 * Quick start:
 *   import { init, text2d } from '@jscadui/jscad-text'
 *   import jscad from '@jscad/modeling'
 *   init(jscad)
 *
 *   // Default: Hershey stroke font, expanded to filled outlines (synchronous)
 *   const geom = text2d('Hello', { size: 10 })
 *
 *   // TTF font via URL (synchronous in browser Web Worker via sync XHR)
 *   const geom = text2d('Hello', {
 *     font: 'https://example.com/Font.ttf',
 *     size: 10,
 *   })
 *
 *   // TTF font via require() plugin (returns ArrayBuffer, always synchronous)
 *   const fontData = require('./MyFont.ttf')
 *   const geom = text2d('Hello', { font: fontData, size: 10 })
 *
 *   // Pre-load TTF for Node.js HTTP URLs (async pre-load required)
 *   await fontLoader.load('https://example.com/Font.ttf')
 *   const geom = text2d('Hello', { font: 'https://example.com/Font.ttf', size: 10 })
 *
 * OpenSCAD text() parameter mapping:
 *   text(text, size, font, halign, valign, spacing, direction, language, script)
 */

import { initHershey, layoutHershey } from './fonts/HersheyAdapter.js'
import { initStrokeExpander, expandLines } from './geometry/StrokeExpander.js'
import { initTTFToGeom2, ttfLinesToGeom2 } from './geometry/TTFToGeom2.js'
import { computeValignOffset } from './layout/Alignment.js'
import { defaultLoader } from './fonts/TTFLoader.js'
import { resolveFont } from './fonts/FontMap.js'

// Injected JSCAD reference
let jscad = null

/**
 * Initialize jscad-text with a JSCAD modeling instance.
 * Must be called before text2d().
 *
 * @param {object} jscadRef - JSCAD modeling object (from @jscad/modeling or equivalent)
 */
export function init(jscadRef) {
  jscad = jscadRef
  initHershey(jscadRef)
  initStrokeExpander(jscadRef)
  initTTFToGeom2(jscadRef)
}

/**
 * Compute a reasonable stroke width for Hershey text.
 * The Hershey simplex font at height=21 has stroke thickness ~2 units.
 * We scale this proportionally to the requested size.
 *
 * @param {number} size - text size (cap height)
 * @returns {number}
 */
function defaultStrokeWidth(size) {
  // OpenSCAD-like thick strokes: ~12% of size gives visually solid text
  return size * 0.12
}

/**
 * Render text as 2D filled geometry (geom2), compatible with OpenSCAD text() semantics.
 *
 * @param {string | object} textOrOptions - text string, or options object with `text` property
 * @param {object} [options] - text options (when first arg is string)
 *
 * @param {string} options.text - text to render (or first arg)
 * @param {number} [options.size=10] - cap height in user units (matches OpenSCAD size)
 * @param {string | ArrayBuffer | Buffer | Uint8Array} [options.font] - font specifier:
 *   - omit/undefined: use Hershey simplex (default, no network needed)
 *   - Name string: looked up in font map (e.g. "Liberation Sans", "Roboto:style=Bold")
 *   - URL string: loaded directly via fetch (http/https/file://)
 *   - File path string: load TTF via fs.readFile (Node.js)
 *   - ArrayBuffer/Buffer/Uint8Array: parse directly (e.g., from require() plugin)
 *   - throws if name not found in map
 * @param {string} [options.halign='left'] - 'left' | 'center' | 'right'
 * @param {string} [options.valign='baseline'] - 'baseline' | 'top' | 'center' | 'bottom'
 * @param {number} [options.spacing=1] - character spacing multiplier
 * @param {string} [options.direction='ltr'] - 'ltr' | 'rtl' (rtl: reverses text)
 * @param {number} [options.$fn=32] - curve tessellation quality for TTF fonts
 * @param {number} [options.strokeWidth] - Hershey stroke width (default: size*0.12)
 *
 * @returns {import('@jscad/modeling').geometries.geom2 | null} a JSCAD geom2, or null for empty text
 */
export function text2d(textOrOptions, options = {}) {
  if (!jscad) throw new Error('jscad-text: call init(jscad) before using text2d()')

  // Normalize arguments
  let opts
  if (typeof textOrOptions === 'string') {
    opts = { text: textOrOptions, ...options }
  } else {
    opts = { ...textOrOptions, ...options }
  }

  const {
    text = '',
    size = 10,
    font,
    halign = 'left',
    valign = 'baseline',
    spacing = 1,
    direction = 'ltr',
    $fn = 32,
    strokeWidth,
  } = opts

  if (!text) return null

  // RTL: reverse the text (basic support for Phase 1)
  const renderText = direction === 'rtl' ? [...text].reverse().join('') : text

  // Choose font mode based on the `font` option
  if (font !== undefined && font !== null && font !== '') {
    // Resolve name → URL/FontData (throws if name not found in map)
    const resolvedFont = typeof font === 'string' ? resolveFont(font) : font
    return renderTTF(renderText, { size, font: resolvedFont, halign, valign, spacing, $fn })
  } else {
    return renderHershey(renderText, { size, halign, valign, spacing, $fn, strokeWidth })
  }
}

/**
 * Render text using a TTF/OTF font asynchronously.
 * The font is loaded and cached; subsequent calls with the same font are sync
 * via text2d() once the font is in cache.
 */
export async function text2dAsync(textOrOptions, options = {}) {
  if (!jscad) throw new Error('jscad-text: call init(jscad) before using text2dAsync()')

  let opts
  if (typeof textOrOptions === 'string') {
    opts = { text: textOrOptions, ...options }
  } else {
    opts = { ...textOrOptions, ...options }
  }

  const {
    text = '',
    size = 10,
    font,
    halign = 'left',
    valign = 'baseline',
    spacing = 1,
    direction = 'ltr',
    $fn = 32,
    strokeWidth,
  } = opts

  if (!text) return null

  const renderText = direction === 'rtl' ? [...text].reverse().join('') : text

  if (font !== undefined && font !== null && font !== '') {
    const resolvedFont = typeof font === 'string' ? resolveFont(font) : font
    // Load into cache, then call sync path
    await defaultLoader.load(resolvedFont)
    return renderTTF(renderText, { size, font: resolvedFont, halign, valign, spacing, $fn })
  } else {
    return renderHershey(renderText, { size, halign, valign, spacing, $fn, strokeWidth })
  }
}

/**
 * Render text using Hershey stroke font (synchronous - no network required).
 */
function renderHershey(text, { size, halign, valign, spacing, $fn, strokeWidth: sw }) {
  const sw_ = sw ?? defaultStrokeWidth(size)

  const layout = layoutHershey(text, { size, spacing, halign })
  const { lines, capHeight, descender, lineSpacing } = layout

  const yOffset = computeValignOffset(valign, {
    capHeight,
    descender,
    totalLines: lines.length,
    lineSpacing,
  })

  // Quality: map $fn to expand segments; cap at reasonable range
  const expandSegs = Math.max(4, Math.min($fn, 64))

  return expandLines(lines, { strokeWidth: sw_, segments: expandSegs, yOffset })
}

/**
 * Render text using a TTF/OTF font (synchronous).
 * Loads the font lazily on first use:
 *   - Browser Web Worker: sync XHR (explicitly permitted in workers)
 *   - Node.js file path: opentype.loadSync() → readFileSync
 *   - ArrayBuffer/Uint8Array: parsed immediately (bytes already in memory)
 *   - Node.js HTTP URL: throws — pre-load with `await fontLoader.load(url)` first
 */
function renderTTF(text, { size, font, halign, valign, spacing, $fn }) {
  const ttfFont = defaultLoader.loadSync(font)

  const layout = ttfFont.layoutText(text, { size, spacing, halign, $fn })
  const { lines, capHeight, descender, lineSpacing } = layout

  const yOffset = computeValignOffset(valign, {
    capHeight,
    descender,
    totalLines: lines.length,
    lineSpacing,
  })

  return ttfLinesToGeom2(lines, yOffset)
}

// Re-export lower-level utilities for power users
export { defaultLoader as fontLoader } from './fonts/TTFLoader.js'
export { TTFFont, TTFLoader, isClockwise } from './fonts/TTFLoader.js'
export { computeValignOffset } from './layout/Alignment.js'
export { resolveFont, registerFonts, listFonts, loadSystemFonts, STATIC_FONT_MAP } from './fonts/FontMap.js'
