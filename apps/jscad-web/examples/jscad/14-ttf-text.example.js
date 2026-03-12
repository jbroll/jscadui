"use strict"
/**
 * Demonstrates TTF font rendering using @jscadui/jscad-text.
 * Fonts are loaded from CDN (Liberation family — the same fonts bundled in OpenSCAD).
 */

const jscad = require('@jscad/modeling')
const { extrudeLinear } = jscad.extrusions

const jscadText = require('@jscadui/jscad-text')

const FONTS = [
  'Liberation Sans',
  'Liberation Sans:style=Bold',
  'Liberation Sans:style=Italic',
  'Liberation Serif',
  'Liberation Serif:style=Bold',
  'Liberation Serif:style=Italic',
  'Liberation Mono',
  'Liberation Mono:style=Bold',
]

const getParameterDefinitions = () => [
  {
    name: 'word',
    type: 'text',
    initial: 'Hello!',
    caption: 'Text to render:',
    size: 40,
  },
  {
    name: 'font',
    type: 'choice',
    caption: 'Font:',
    values: FONTS,
    initial: 'Liberation Sans',
  },
  {
    name: 'size',
    type: 'slider',
    initial: 10,
    min: 4,
    max: 30,
    step: 1,
    caption: 'Size:',
  },
  {
    name: 'height',
    type: 'slider',
    initial: 3,
    min: 1,
    max: 15,
    step: 0.5,
    caption: 'Extrusion height:',
  },
]

const main = (params) => {
  jscadText.init(jscad)

  const { word, font, size, height } = params
  if (!word) return []

  const geom2 = jscadText.text2d(word, { font, size })
  if (!geom2) return []

  return extrudeLinear({ height }, geom2)
}

module.exports = { main, getParameterDefinitions }
