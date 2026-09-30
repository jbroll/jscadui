import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { mimeOf, safeJoin } from './static.js'

describe('mimeOf', () => {
  it.each([
    ['font.ttf', 'font/ttf'],
    ['font.woff2', 'font/woff2'],
    ['bundle.js.map', 'application/json'],
    ['part.scad', 'text/plain'],
    ['model.jscad', 'application/javascript'],
    ['index.html', 'text/html'],
    ['engine.wasm', 'application/wasm'],
  ])('%s is %s', (file, type) => {
    expect(mimeOf(file)).toBe(type)
  })

  it('ignores extension case', () => {
    expect(mimeOf('MODEL.STL')).toBe('model/stl')
  })

  it('falls back to octet-stream', () => {
    expect(mimeOf('blob.xyz')).toBe('application/octet-stream')
    expect(mimeOf('Makefile')).toBe('application/octet-stream')
  })
})

describe('safeJoin', () => {
  const root = resolve('/srv/app')

  it('joins a path under root, leading slash or not', () => {
    expect(safeJoin(root, '/a/b.js')).toBe(join(root, 'a', 'b.js'))
    expect(safeJoin(root, 'a/b.js')).toBe(join(root, 'a', 'b.js'))
    expect(safeJoin(root, '/')).toBe(root)
  })

  it('rejects paths that leave root', () => {
    expect(safeJoin(root, '../etc/passwd')).toBeNull()
    expect(safeJoin(root, '/a/../../x')).toBeNull()
    expect(safeJoin(root, '../app-other/x')).toBeNull()
  })

  it('resolves a relative or trailing-slash root before comparing', () => {
    expect(safeJoin(`${root}/`, 'x.js')).toBe(join(root, 'x.js'))
    expect(safeJoin('build', 'x.js')).toBe(resolve('build', 'x.js'))
  })
})
