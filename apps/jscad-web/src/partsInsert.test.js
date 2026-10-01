import { ChangeSet, Text } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { planInsert } from './partsInsert.js'

const entry = { call: 'nut', require: 'NopSCADlib/vitamins/nuts.scad', scadIncludes: ['NopSCADlib/vitamins/nuts.scad'] }

// The real CodeMirror change applier, not a hand-rolled one: this is what
// editor.applyEdit actually dispatches, including its same-offset ordering.
const apply = (doc, { changes }) =>
  ChangeSet.of(changes, doc.length)
    .apply(Text.of(doc.split('\n')))
    .toString()

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

  it('appends the entry insertArgs after the size', () => {
    const screw = { call: 'screw', require: '_catalog/NopSCADlib/vitamins/screw.scad', scadIncludes: ['NopSCADlib/core.scad', 'NopSCADlib/vitamins/screw.scad'], insertArgs: [10] }
    const js = apply('', planInsert({ doc: '', cursor: 0, path: '/main.js', entry: screw, size: 'M3_cap_screw' }))
    expect(js).toBe("const { screw, M3_cap_screw } = require('_catalog/NopSCADlib/vitamins/screw.scad')\nscrew(M3_cap_screw, 10)")
    const scad = apply('', planInsert({ doc: '', cursor: 0, path: '/main.scad', entry: screw, size: 'M3_cap_screw' }))
    expect(scad).toBe('include <NopSCADlib/core.scad>\ninclude <NopSCADlib/vitamins/screw.scad>\nscrew(M3_cap_screw, 10);')
  })

  it('adds include lines and the call to a scad file', () => {
    const doc = 'include <BOSL2/std.scad>\n\n'
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.scad', entry: e, size: '"M3"' }))
    expect(out).toBe('include <BOSL2/screws.scad>\ninclude <BOSL2/std.scad>\n\nnut("M3");')
  })

  it('does not duplicate an include written without a space', () => {
    const doc = 'include<BOSL2/std.scad>\n\n'
    const e = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.scad', entry: e, size: '"M3"' }))
    expect(out).toBe('include <BOSL2/screws.scad>\ninclude<BOSL2/std.scad>\n\nnut("M3");')
  })

  it('preserves a multi-line destructuring when adding a missing name', () => {
    const doc = "const {\n  nut,\n} = require('NopSCADlib/vitamins/nuts.scad')\n\n"
    const out = apply(doc, planInsert({ doc, cursor: doc.length, path: '/main.js', entry, size: 'M4_nut' }))
    expect(out).toBe("const {\n  nut, M4_nut,\n} = require('NopSCADlib/vitamins/nuts.scad')\n\nnut(M4_nut)")
  })

  it('puts the call on its own line when the cursor sits on non-blank code', () => {
    const doc = 'cube()\n'
    const out = apply(doc, planInsert({ doc, cursor: 6, path: '/main.js', entry, size: 'M3_nut' }))
    expect(out).toBe("const { nut, M3_nut } = require('NopSCADlib/vitamins/nuts.scad')\ncube()\nnut(M3_nut)\n\n")
  })

  it('returns a cursor at the end of the inserted call', () => {
    const screws = { call: 'nut', require: '_catalog/BOSL2/screws.scad', scadIncludes: ['BOSL2/std.scad', 'BOSL2/screws.scad'] }
    const docA = 'const main = () => {\n  \n}\n'
    const docB = "const { nut } = require('NopSCADlib/vitamins/nuts.scad')\n\n"
    const docC = ''
    const docD = 'include <BOSL2/std.scad>\n\n'
    const cases = [
      { doc: docA, cursor: 23, path: '/main.js', entry, size: 'M3_nut', call: 'nut(M3_nut)' },
      { doc: docB, cursor: docB.length, path: '/main.js', entry, size: 'M4_nut', call: 'nut(M4_nut)' },
      { doc: docC, cursor: 0, path: '/main.js', entry: screws, size: '"M3"', call: 'nut("M3")' },
      { doc: docD, cursor: docD.length, path: '/main.scad', entry: screws, size: '"M3"', call: 'nut("M3");' },
    ]
    for (const { doc, cursor, path, entry: e, size, call } of cases) {
      const plan = planInsert({ doc, cursor, path, entry: e, size })
      const out = apply(doc, plan)
      expect(out.slice(plan.cursor - call.length, plan.cursor)).toBe(call)
    }
  })
})
