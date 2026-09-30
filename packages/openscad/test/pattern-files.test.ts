import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPatternFile, discoverPatternFiles, matchesPattern, matchesAny, matchesScopes } from '../bin/pattern-files.js'

describe('matchesPattern', () => {
  it('matches an unanchored pattern against the relative path or the basename', () => {
    expect(matchesPattern('a/b/model.scad', 'model.scad')).toBe(true)
    expect(matchesPattern('a/b/model.scad', 'b/model.scad')).toBe(false)
    expect(matchesPattern('a/b/model.scad', 'a/b/model.scad')).toBe(true)
  })

  it('lets an unanchored * cross /', () => {
    expect(matchesPattern('a/b/model.scad', 'a*.scad')).toBe(true)
    expect(matchesPattern('a/b/model.scad', '*-test.scad')).toBe(false)
  })

  it('matches an anchored pattern against the relative path only', () => {
    expect(matchesPattern('model.scad', '/model.scad')).toBe(true)
    expect(matchesPattern('a/model.scad', '/model.scad')).toBe(false)
  })

  it('keeps an anchored * within one segment and lets ** cross segments', () => {
    expect(matchesPattern('top.scad', '/*.scad')).toBe(true)
    expect(matchesPattern('a/top.scad', '/*.scad')).toBe(false)
    expect(matchesPattern('a/b/top.scad', '/a/**.scad')).toBe(true)
    expect(matchesPattern('a/b/top.scad', '/a/*.scad')).toBe(false)
  })

  it('matches a directory pattern against the directory and everything below it', () => {
    expect(matchesPattern('lib/', 'lib/')).toBe(true)
    expect(matchesPattern('lib/x.scad', 'lib/')).toBe(true)
    expect(matchesPattern('lib/deep/x.scad', '/lib/')).toBe(true)
    expect(matchesPattern('lib', 'lib/')).toBe(false)
    expect(matchesPattern('src/lib/x.scad', 'lib/')).toBe(false)
  })

  it('matches a file pattern against a directory by its name', () => {
    expect(matchesPattern('a/tests/', 'tests')).toBe(true)
    expect(matchesPattern('tests/', '/tests')).toBe(true)
  })

  it('reads every pattern as anchored when asked', () => {
    expect(matchesPattern('a/model.scad', 'model.scad', { anchored: true })).toBe(false)
    expect(matchesPattern('model.scad', 'model.scad', { anchored: true })).toBe(true)
    expect(matchesPattern('a/b.scad', '*.scad', { anchored: true })).toBe(false)
  })

  it('treats regex characters literally', () => {
    expect(matchesPattern('a+b(1).scad', 'a+b(1).scad')).toBe(true)
    expect(matchesPattern('axscad', 'a.scad')).toBe(false)
  })
})

describe('matchesAny', () => {
  it('is true when one pattern matches', () => {
    expect(matchesAny('x/y.scad', ['z.scad', 'y.scad'])).toBe(true)
    expect(matchesAny('x/y.scad', [])).toBe(false)
  })
})

describe('pattern files on disk', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pattern-files-'))
    mkdirSync(join(root, 'lib-a', 'sub'), { recursive: true })
    mkdirSync(join(root, 'lib-b'), { recursive: true })
    mkdirSync(join(root, '.hidden'), { recursive: true })
    writeFileSync(join(root, 'skip.txt'), '# why\n\n  root.scad  \n')
    writeFileSync(join(root, 'lib-a', 'skip.txt'), 'broken.scad\n')
    writeFileSync(join(root, 'lib-a', 'sub', 'skip.txt'), '# only comments\n')
    writeFileSync(join(root, 'lib-b', 'exclude.txt'), 'parts/\n')
    writeFileSync(join(root, '.hidden', 'skip.txt'), 'hidden.scad\n')
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('reads patterns without blank lines, comments or surrounding space', () => {
    expect(readPatternFile(join(root, 'skip.txt'))).toEqual(['root.scad'])
  })

  it('reads a missing file as no patterns', () => {
    expect(readPatternFile(join(root, 'none.txt'))).toEqual([])
  })

  it('discovers non-empty pattern files outside dot-directories', () => {
    expect(discoverPatternFiles(root, 'skip.txt')).toEqual([
      { dir: root, patterns: ['root.scad'] },
      { dir: join(root, 'lib-a'), patterns: ['broken.scad'] },
    ])
    expect(discoverPatternFiles([join(root, 'lib-a'), join(root, 'missing')], 'skip.txt'))
      .toEqual([{ dir: join(root, 'lib-a'), patterns: ['broken.scad'] }])
  })

  it('applies a pattern file only below its own directory', () => {
    const skips = discoverPatternFiles(root, 'skip.txt')
    expect(matchesScopes(join(root, 'lib-a', 'sub', 'broken.scad'), skips)).toBe(true)
    expect(matchesScopes(join(root, 'lib-b', 'broken.scad'), skips)).toBe(false)
    expect(matchesScopes(join(root, 'lib-b', 'root.scad'), skips)).toBe(true)
  })

  it('matches a directory path given with a trailing /', () => {
    const excludes = discoverPatternFiles(root, 'exclude.txt')
    expect(matchesScopes(join(root, 'lib-b', 'parts') + '/', excludes)).toBe(true)
    expect(matchesScopes(join(root, 'lib-b', 'parts', 'gear.scad'), excludes)).toBe(true)
    expect(matchesScopes(join(root, 'lib-a', 'parts', 'gear.scad'), excludes)).toBe(false)
  })
})
