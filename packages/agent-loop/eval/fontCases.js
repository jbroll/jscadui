// Models for the tests that every font the app's static font map offers
// builds in the eval, as it does in the frame.
import { STATIC_FONT_MAP } from '@jscadui/jscad-text'

export const FONT_NAMES = Object.keys(STATIC_FONT_MAP)

export const everyFont = (names = FONT_NAMES) => `const { extrusions } = require('@jscad/modeling')
const jscadText = require('@jscadui/jscad-text')
jscadText.init(require('@jscad/modeling'))
const names = ${JSON.stringify(names)}
module.exports = { main: () => names.map((font) => extrusions.extrudeLinear({ height: 1 }, jscadText.text2d('Ag', { size: 5, font }))) }`

export const UNKNOWN_FONT = `const jscadText = require('@jscadui/jscad-text')
jscadText.init(require('@jscad/modeling'))
module.exports = { main: () => jscadText.text2d('JOHN', { font: 'Comic Sans MS' }) }`
