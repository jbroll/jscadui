/**
 * Text module - re-exports from @jscad/modeling-for-manifold.
 *
 * Texts provide sets of segments for each character or text strings.
 * The segments can be used to create outlines for both 2D and 3D geometry.
 */

import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

const jscadText = jscad.text

/**
 * Construct the segments for a single character.
 *
 * @param {Object|string} options - Options or character
 * @param {number} [options.xOffset=0] - X offset
 * @param {number} [options.yOffset=0] - Y offset
 * @param {number} [options.height=21] - Font height
 * @param {number} [options.extrudeOffset=0] - Extrude offset
 * @param {string} [options.font] - Font name
 * @param {string} [char] - Character to create
 * @returns {Object} Object with segments and width
 */
export const vectorChar = (options, char) => {
  return jscadText.vectorChar(options, char)
}

/**
 * Construct the segments for a string of text.
 *
 * @param {Object|string} options - Options or text string
 * @param {number} [options.xOffset=0] - X offset
 * @param {number} [options.yOffset=0] - Y offset
 * @param {number} [options.height=21] - Font height
 * @param {number} [options.lineSpacing=1.4] - Line spacing multiplier
 * @param {number} [options.letterSpacing=1] - Letter spacing multiplier
 * @param {string} [options.align='left'] - Text alignment
 * @param {number} [options.extrudeOffset=0] - Extrude offset
 * @param {string} [options.font] - Font name
 * @param {string} [text] - Text string to create
 * @returns {Array} Array of objects with segments for each line
 */
export const vectorText = (options, text) => {
  return jscadText.vectorText(options, text)
}

export default {
  vectorChar,
  vectorText
}
