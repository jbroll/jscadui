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
    // Font not available — find a metric-compatible alias rather than blindly falling back.
    // Common fonts (Arial, Arial Black, Tahoma, etc.) are pre-mapped in FontMap's STATIC_FONT_MAP.
    // This catch handles fonts not in that map (custom/rare fonts).
    const alias = _findFontAlias(font)
    if (alias && alias !== font) {
      console.warn(`text(): font '${font}' not available, using metric-compatible alias '${alias}'`)
      return _text({ text, size, font: alias, halign, valign, spacing, direction, $fn, $fa, $fs })
    }
    console.warn(`text(): font '${font}' not available: ${e.message}`)
    return null
  }
}

/**
 * Find a metric-compatible font alias for an unavailable font.
 *
 * Uses font name pattern matching to select the closest Liberation font:
 *   - Symbol/emoji/CJK fonts → null (no reasonable substitute)
 *   - Monospace-like names → Liberation Mono
 *   - Serif-like names → Liberation Serif
 *   - Sans-serif/unknown → Liberation Sans
 *
 * Known common fonts (Arial Black, Tahoma, etc.) should be in STATIC_FONT_MAP
 * in FontMap.js so they never reach this function.
 *
 * @param {string} font - OpenSCAD font name (possibly with ":style=..." qualifier)
 * @returns {string|null} alias font name or null if no reasonable substitute
 */
function _findFontAlias(font) {
  const baseName = font.replace(/:style=.*/, '').trim()
  const styleMatch = font.match(/:style=(.+)/i)
  const style = styleMatch ? styleMatch[1].toLowerCase() : ''
  const lowerBase = baseName.toLowerCase()

  // Symbol / emoji / dingbat fonts — no Latin metric substitute
  if (/webding|wingding|symbol|emoji|icon|dingbat|zapf|marlett/.test(lowerBase)) return null

  // CJK / non-Latin fonts — detect by Unicode characters in the font name
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Hebrew}/u.test(baseName)) return null

  // Monospace fonts
  if (/\bmono\b|code|console|typewriter|courier|\bfixed\b|terminal/.test(lowerBase)) {
    if (style.includes('bold') && style.includes('italic')) return 'Liberation Mono:style=Bold Italic'
    if (style.includes('bold')) return 'Liberation Mono:style=Bold'
    if (style.includes('italic')) return 'Liberation Mono:style=Italic'
    return 'Liberation Mono'
  }

  // Serif fonts
  if (/\bserif\b|roman|garamond|georgia|palatino|antiqua|bookman|century|charter|bodoni|caslon|cambria/.test(lowerBase)) {
    if (style.includes('bold') && style.includes('italic')) return 'Liberation Serif:style=Bold Italic'
    if (style.includes('bold')) return 'Liberation Serif:style=Bold'
    if (style.includes('italic')) return 'Liberation Serif:style=Italic'
    return 'Liberation Serif'
  }

  // Sans-serif and general Latin fonts — Liberation Sans is OpenSCAD's fontconfig default
  if (style.includes('bold') && style.includes('italic')) return 'Liberation Sans:style=Bold Italic'
  if (style.includes('bold')) return 'Liberation Sans:style=Bold'
  if (style.includes('italic')) return 'Liberation Sans:style=Italic'
  return 'Liberation Sans'
}
