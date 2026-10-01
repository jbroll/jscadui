import { describe, it, expect } from 'vitest'
import { planInsert } from './partsInsert.js'

const entry = { call: 'nut', require: 'NopSCADlib/vitamins/nuts.scad', scadIncludes: ['NopSCADlib/vitamins/nuts.scad'] }
const apply = (doc, { changes }) => [...changes].sort((a, b) => b.from - a.from).reduce((d, c) => d.slice(0, c.from) + c.insert + d.slice(c.to ?? c.from), doc)

describe('planInsert', () => {
  it('adds a require and the call to a js file', () => {
    const doc = 'const main = () => {\n  \n}\n'
    const out = apply(doc, planInsert({ doc, cursor: 23, path: '/main.js', entry, size: 'M3_nut' }))
    expect(out).toBe("const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')\nconst main = () => {\n  nut(M3_nut)\n}\n")
  })

  it('adds missing names to an existing require', () => {
    const doc = "const { nut } = require('NopSCADlib/vitamins/nuts.scad')\n\n"
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.js', entry, size: 'M4_nut' }))
    expect(out).toBe("const { nut, M4_nut } = require('NopSCADlib/vitamins/nuts.scad')\n\nnut(M4_nut)")
  })

  it('quotes nothing for a string size and adds no name for it', () => {
    const doc = ''
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: 0, path: '/main.js', entry: e, size: '"M3"' }))
    expect(out).toBe("const { nut } = require('_catalog/BOSL2/screws.scad')\nnut(\"M3\")")
  })

  it('adds include lines and the call to a scad file', () => {
    const doc = 'include <BOSL2/std.scad>\n\n'
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.scad', entry: e, size: '"M3"' }))
    expect(out).toBe('include <BOSL2/screws.scad>\ninclude <BOSL2/std.scad>\n\nnut("M3");')
  })
})
