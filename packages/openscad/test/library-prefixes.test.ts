import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LIBRARY_PREFIXES, resolveLibraryPrefix } from '../bin/libraryPrefixes.js'
import { tempDir } from './tempDir.js'

const makeTree = () => {
  const root = tempDir('libprefix-')
  mkdirSync(join(root, 'libs', 'BOSL2'), { recursive: true })
  writeFileSync(join(root, 'libs', 'BOSL2', 'std.scad'), '// std')
  mkdirSync(join(root, 'libs', 'BOSL'), { recursive: true })
  writeFileSync(join(root, 'libs', 'BOSL', 'math.scad'), '// math')
  return root
}

describe('resolveLibraryPrefix', () => {
  it('resolves an upstream root into the mapped dir', () => {
    const root = makeTree()
    const prefixes = { 'BOSL2/': 'libs/BOSL2/', 'BOSL/': 'libs/' }
    expect(resolveLibraryPrefix('BOSL2/std.scad', prefixes, root))
      .toBe(join(root, 'libs', 'BOSL2', 'std.scad'))
  })

  it('prefers the longest matching prefix', () => {
    const root = makeTree()
    const prefixes = { 'BOSL/': 'libs/BOSL/', 'BOSL2/': 'libs/BOSL2/' }
    expect(resolveLibraryPrefix('BOSL2/std.scad', prefixes, root))
      .toBe(join(root, 'libs', 'BOSL2', 'std.scad'))
    expect(resolveLibraryPrefix('BOSL/math.scad', prefixes, root))
      .toBe(join(root, 'libs', 'BOSL', 'math.scad'))
  })

  it('returns undefined when nothing matches or the file is absent', () => {
    const root = makeTree()
    const prefixes = { 'BOSL2/': 'libs/BOSL2/' }
    expect(resolveLibraryPrefix('other/std.scad', prefixes, root)).toBeUndefined()
    expect(resolveLibraryPrefix('BOSL2/missing.scad', prefixes, root)).toBeUndefined()
  })

  it('ships the corpus prefix table', () => {
    expect(Object.keys(DEFAULT_LIBRARY_PREFIXES).sort()).toEqual(
      ['BOSL/', 'BOSL2/', 'MCAD/', 'list-comprehension-demos/'].sort()
    )
  })
})
