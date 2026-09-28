import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportedGeometry, initScadRuntime, evalScadSolidSync } from '../bin/run-jscad.js'

describe('exportedGeometry', () => {
  it('unwraps a lone solid left after dropping ghosts, same as no ghosts at all', () => {
    const solid = { id: 1 }
    expect(exportedGeometry([solid, { previewOnly: true }])).toBe(solid)
  })

  it('keeps multiple remaining solids as an array', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    expect(exportedGeometry([a, b, { previewOnly: true }])).toEqual([a, b])
  })

  it('is null when only ghosts remain', () => {
    expect(exportedGeometry([{ previewOnly: true }])).toBe(null)
  })

  it('passes a single geometry through', () => {
    const solid = { id: 1 }
    expect(exportedGeometry(solid)).toBe(solid)
  })
})

describe('evalScadSolidSync with ghosts and an empty result', () => {
  it('does not throw when an intersection is empty and only ghost children remain', async () => {
    const ctx = await initScadRuntime()
    const dir = mkdtempSync(join(tmpdir(), 'export-ghosts-'))
    const file = join(dir, 'issue1833.scad')
    writeFileSync(file, `
      intersection() {
        #translate([2, 0, 0]) cube(1);
        #cube(1);
      }
    `)
    expect(() => evalScadSolidSync(file, ctx)).not.toThrow()
  })
})
