import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { buildExamplesManifest, isGridFile } from '../src_build/genExamplesManifest.js'

describe('isGridFile', () => {
  it('matches ALL.js and per-category grids only', () => {
    expect(['ALL.js', 'ALL.printed.js', 'ALL.vitamins-motion.js'].every(isGridFile)).toBe(true)
    expect(['ALLOY.js', 'box.scad', 'ALL.scad', 'x/ALL.js'].some(isGridFile)).toBe(false)
  })
})

describe('buildExamplesManifest', () => {
  let root, tree

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'manifest-'))
    const write = (rel, text = '') => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), text)
    }
    write('lib-a/outer/tests/one.scad')
    for (const f of ['ALL.js', 'ALL.small.js', 'ALL.big.js', 'a.scad', 'b.scad', 'c.scad', 'd.scad', 'loose.scad']) write(`lib-b/tests/${f}`)
    write('lib-b/tests/skip.txt', 'd.scad\n')
    write('lib-b/tests/categories.json', JSON.stringify({ small: ['a', 'b'], big: ['c'], gone: ['d'] }))
    tree = buildExamplesManifest(root, '/examples')
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lists real directories as they are', () => {
    expect(tree['/examples/lib-a/']).toEqual({ dirs: ['outer'], files: [] })
    expect(tree['/examples/lib-a/outer/tests/']).toEqual({ dirs: [], files: ['one.scad'] })
  })

  it('shows categories as folders, in map order, and keeps the rest in place', () => {
    expect(tree['/examples/lib-b/tests/']).toEqual({ dirs: ['small', 'big'], files: ['ALL.js', 'loose.scad'] })
  })

  it('points each category entry at its real file, the grid as ALL.js', () => {
    expect(tree['/examples/lib-b/tests/small/']).toEqual({
      dirs: [],
      files: ['ALL.js', 'a.scad', 'b.scad'],
      href: { 'ALL.js': '../ALL.small.js', 'a.scad': '../a.scad', 'b.scad': '../b.scad' },
    })
  })

  it('drops a category whose models are all skipped', () => {
    expect(tree['/examples/lib-b/tests/gone/']).toBeUndefined()
  })
})
