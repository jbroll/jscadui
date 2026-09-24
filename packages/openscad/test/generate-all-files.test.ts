import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const generator = join(__dirname, '..', 'bin', 'generate-all-files.js')

const itemsOf = (file: string): string[] =>
  JSON.parse(readFileSync(file, 'utf8').match(/const items = (\[[\s\S]*?\])\n/)![1])

describe('generate-all-files', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'gen-all-'))
    const touch = (rel: string) => {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), 'cube(1);\n')
    }
    touch('lib-a/outer/tests/one.scad')
    touch('lib-a/outer/tests/two.scad')
    touch('lib-b/x.scad')
    touch('lib-b/y.scad')
    for (const name of ['a', 'b', 'c', 'loose']) touch(`lib-c/tests/${name}.scad`)
    writeFileSync(join(root, 'lib-c/tests/categories.json'), JSON.stringify({ small: ['a', 'b'], big: ['c'], none: ['z'] }))
    touch('lib-c/tests/ALL.stale.js')
    execFileSync('node', [generator, '--no-rename', '--examples-dir', root], { stdio: 'pipe', timeout: 30_000 })
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('writes no grid whose only item is another grid', () => {
    expect(existsSync(join(root, 'lib-a', 'ALL.js'))).toBe(false)
    expect(existsSync(join(root, 'lib-a', 'outer', 'ALL.js'))).toBe(false)
    expect(itemsOf(join(root, 'lib-a', 'outer', 'tests', 'ALL.js'))).toEqual(['./one.scad', './two.scad'])
  })

  it('points the parent at the grid a wrapper would have held', () => {
    expect(itemsOf(join(root, 'ALL.js'))).toEqual(['./lib-a/outer/tests/ALL.js', './lib-b/ALL.js', './lib-c/tests/ALL.js'])
  })

  it('writes one grid per category beside the models', () => {
    const tests = join(root, 'lib-c', 'tests')
    expect(itemsOf(join(tests, 'ALL.small.js'))).toEqual(['./a.scad', './b.scad'])
    expect(itemsOf(join(tests, 'ALL.big.js'))).toEqual(['./c.scad'])
    expect(existsSync(join(tests, 'ALL.none.js'))).toBe(false)
  })

  it('aggregates the category grids, then models no category lists', () => {
    expect(itemsOf(join(root, 'lib-c', 'tests', 'ALL.js'))).toEqual(['./ALL.small.js', './ALL.big.js', './loose.scad'])
  })

  it('removes stale category grids', () => {
    expect(existsSync(join(root, 'lib-c', 'tests', 'ALL.stale.js'))).toBe(false)
  })
})
