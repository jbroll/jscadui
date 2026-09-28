import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'

const LIBERATION_TTF = fileURLToPath(new URL('../../jscad-text/src/fonts/data/LiberationSans-Regular.ttf', import.meta.url))

describe('j$.useFont', () => {
  beforeAll(() => { j$.init(jscad) })

  it('makes text() find the font by family and style', () => {
    expect(j$.useFont(new Uint8Array(readFileSync(LIBERATION_TTF)))).toBeUndefined()
    const warn = vi.spyOn(console, 'warn')
    try {
      const geom = j$.text({ text: 'A', font: 'Liberation Sans:style=Regular' })
      expect(jscad.geometries.geom2.toSides(geom).length).toBeGreaterThan(0)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
