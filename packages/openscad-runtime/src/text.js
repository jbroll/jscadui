/**
 * OpenSCAD text() primitive runtime implementation.
 *
 * Bridges OpenSCAD's text() builtin to @jscadui/jscad-text.
 * Returns geom2 synchronously (Hershey default) or throws if TTF font not pre-loaded.
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
 * Uses Hershey simplex font by default (sync, no network required).
 * For TTF fonts, pre-load via: await fontLoader.load(url)
 */
export const _text = ({
  text = '',
  size = 10,
  font,
  halign = 'left',
  valign = 'baseline',
  spacing = 1,
  direction = 'ltr',
  $fn,
  $fa,
  $fs,
} = {}) => {
  if (!text) return undefined

  const fn = $fn ?? _getSegments(size / 2, $fn, $fa, $fs)

  // Initialize jscad-text with jscad instance (once per runtime)
  if (!textInitDone && jscad) {
    initJscadText(jscad)
    textInitDone = true
  }

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
}
