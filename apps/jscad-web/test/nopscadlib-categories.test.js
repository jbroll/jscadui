import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'openscad', 'nopscadlib', 'NopSCADlib', 'tests')
const categories = JSON.parse(readFileSync(join(testsDir, 'categories.json'), 'utf8'))
const tests = readdirSync(testsDir).filter(f => f.endsWith('.scad')).map(f => f.slice(0, -'.scad'.length))
const listed = Object.values(categories).flat()

describe('NopSCADlib test categories', () => {
  it('lists every test model', () => {
    expect(tests.filter(t => !listed.includes(t))).toEqual([])
  })

  it('lists no model twice', () => {
    expect(listed.filter((t, i) => listed.indexOf(t) !== i)).toEqual([])
  })

  it('lists only models that exist', () => {
    expect(listed.filter(t => !tests.includes(t))).toEqual([])
  })
})
