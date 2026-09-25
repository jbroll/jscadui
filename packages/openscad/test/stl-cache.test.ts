import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { StlCache, stlCachePath } from '../bin/stl-cache.js'

// NOTE: exercises the real ~/.cache tree under a unique lib name;
// cleaned up after each test. Mirrors production layout: the lib hash
// covers lib/ only, so test-file edits do not trigger lib invalidation.
const lib = `stl-test-${process.pid}`
const cacheLibDir = () => join(homedir(), '.cache', 'jscadui', 'openscad-stl', lib)

let root: string
let model: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stl-cache-test-'))
  mkdirSync(join(root, 'examples', 'openscad', lib, '01-part1'), { recursive: true })
  mkdirSync(join(root, 'examples', 'openscad', lib, 'lib'), { recursive: true })
  writeFileSync(join(root, 'examples', 'openscad', lib, 'lib', 'dep.scad'), 'module dep() cube(1);\n')
  model = join(root, 'examples', 'openscad', lib, '01-part1', 'model.scad')
  writeFileSync(model, 'cube(10);\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cacheLibDir(), { recursive: true, force: true })
})

function saveRef(cache: InstanceType<typeof StlCache>, body = 'solid ref\nendsolid ref\n') {
  const stl = join(root, 'ref.stl')
  writeFileSync(stl, body)
  cache.saveHit(model, stl, 0)
  cache.flush()
}

describe('StlCache content validation', () => {
  it('hits when source content is unchanged', () => {
    const a = new StlCache('v1')
    expect(a.check(model, 0)).toBeNull()
    saveRef(a)
    const hit = new StlCache('v1').check(model, 0)
    expect(hit && 'stlPath' in hit && hit.stlPath).toBeTruthy()
  })

  it('misses after the source file changes', () => {
    const a = new StlCache('v1')
    expect(a.check(model, 0)).toBeNull()
    saveRef(a)
    writeFileSync(model, 'cube(20);\n')
    expect(new StlCache('v1').check(model, 0)).toBeNull()
  })

  it('misses legacy entries that have no content hash', () => {
    const dest = stlCachePath(model, 0, lib)!
    mkdirSync(dirname(dest), { recursive: true })
    const stl = join(root, 'ref.stl')
    writeFileSync(stl, 'solid legacy\nendsolid legacy\n')
    copyFileSync(stl, dest)
    expect(new StlCache('v1').check(model, 0)).toBeNull()
  })

  it('failed sentinels miss after the source file changes', () => {
    const a = new StlCache('v1')
    expect(a.check(model, 0)).toBeNull()
    a.saveFailed(model, 0, 'boom')
    a.flush()
    expect(new StlCache('v1').check(model, 0)).toMatchObject({ failed: 'boom' })
    writeFileSync(model, 'cube(20);\n')
    expect(new StlCache('v1').check(model, 0)).toBeNull()
  })
})
