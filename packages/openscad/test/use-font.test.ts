import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import { ErrorCode, type FileResolver } from '../src/transpiler/context.js'

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

describe('use <font.ttf>', () => {
  const resolver: FileResolver = (filename) =>
    /\.(ttf|otf)$/i.test(filename) ? { path: `/fonts/${filename}`, content: '\u0000\u0001binary' } : undefined

  const transpileMain = (source: string) =>
    transpile(parse(source).ast, { currentFile: '/main.scad', fileResolver: resolver })

  it('registers the font file with j$.useFont before any other code runs', () => {
    const result = transpileMain('use <Sans.ttf>\nx = 1;\ntext("A", font="Sans");')
    expect(result.code).toContain("j$.useFont(require('/fonts/Sans.ttf'))")
    expect(result.code.indexOf('j$.useFont')).toBeLessThan(result.code.indexOf('var x'))
    expect(result.code).not.toMatch(/var \w+ = require\('\/fonts\/Sans\.ttf'\)/)
    expect(result.errors).toEqual([])
  })

  it('matches .otf and upper-case extensions', () => {
    const result = transpileMain('use <A.OTF>\nuse <B.TTF>\n')
    expect(result.code).toContain("j$.useFont(require('/fonts/A.OTF'))")
    expect(result.code).toContain("j$.useFont(require('/fonts/B.TTF'))")
    expect(result.errors).toEqual([])
  })

  it('reports an unresolvable font file as FILE_NOT_FOUND and emits no require', () => {
    const result = transpile(parse('use <missing.ttf>\n').ast, {
      currentFile: '/main.scad',
      fileResolver: () => undefined,
    })
    expect(result.code).not.toContain('missing.ttf')
    expect(result.errors.map(e => e.code)).toEqual([ErrorCode.FILE_NOT_FOUND])
  })
})
