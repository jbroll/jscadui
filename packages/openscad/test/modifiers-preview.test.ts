import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'

const marker = { polygons: [] }

const runMainWith = (src: string, preview: boolean) => {
  const { code } = transpile(parse(src).ast, { currentFile: '/mod.scad' })
  const fn = new Function('require', 'module', 'exports', 'j$', code)
  const mod = { exports: {} as Record<string, unknown> }
  const runtime = j$ as unknown as { cube: unknown }
  const realCube = runtime.cube
  runtime.cube = () => marker
  j$.setSpecialVar('$preview', preview)
  try {
    fn(() => ({}), mod, mod.exports, j$)
    return (mod.exports.main as () => unknown)()
  } finally {
    runtime.cube = realCube
    j$.setSpecialVar('$preview', false)
  }
}

describe('% background modifier follows $preview at run time', () => {
  it('renders the child when $preview is set', () => {
    expect(runMainWith('%cube(10);', true)).toBe(marker)
  })

  it('excludes the child when $preview is clear', () => {
    expect(runMainWith('%cube(10);', false)).toBeUndefined()
  })
})
