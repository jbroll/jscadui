import { describe, expect, it } from 'vitest'
import { shouldTransform } from './shouldTransform.js'

describe('shouldTransform', () => {
  it('transforms every TypeScript file', () => {
    expect(shouldTransform('http://project.local/main.ts', 'module.exports = {}')).toBe(true)
  })

  it.each([
    ["import { primitives } from '@jscad/modeling'"],
    ["import jscad from '@jscad/modeling'"],
    ["import * as jscad from '@jscad/modeling'"],
    ["import def, { a } from './a.js'"],
    ["// imports the parts\nexport { cube } from './cube.js'"],
  ])('transforms a script with an import or export-from line: %s', (line) => {
    expect(shouldTransform('http://project.local/main.js', `${line}\nexport const main = () => []`)).toBe(true)
  })

  it('leaves an export-from line to the loader when the script never says import', () => {
    expect(shouldTransform('http://project.local/main.js', "export { cube } from './cube.js'")).toBe(false)
  })

  it.each([
    ['module.exports = { main: () => [] }'],
    ['export const main = () => []'],
    ["const important = require('./a.js')"],
    ["import('./a.js')"],
  ])('leaves a script with neither to the loader: %s', (script) => {
    expect(shouldTransform('http://project.local/main.js', script)).toBe(false)
  })
})
