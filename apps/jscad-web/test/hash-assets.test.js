import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hashAssetGraph } from '../src_build/hashAssets.js'

const HASHED = /^[\w.-]+\.[0-9a-f]{8}\.(js|css)$/

let dir
const write = (path, text) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}
const read = (path) => readFileSync(join(dir, path), 'utf8')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hash-assets-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const app = () => {
  write('build/bundle.regl.js', 'regl')
  write('build/bundle.threejs.js', 'three')
  write('build/bundle.threejs.js.map', 'map')
  write('main.css', 'body{}')
  write('main.js', 'load("build/bundle.regl.js"); load("build/bundle.threejs.js")')
  write('index.html', '<link href="main.css"><script src="./main.js"></script>')
}
const hashApp = () => hashAssetGraph(dir, { assets: 'build', entries: ['main.css', 'main.js'], htmlRefs: ['main.js', 'main.css'] })

describe('hashAssetGraph', () => {
  it('hashes leaves and entries and points index.html at the hashed entries', () => {
    app()
    const map = hashApp()
    expect(Object.keys(map).sort()).toEqual(['bundle.regl.js', 'bundle.threejs.js', 'main.css', 'main.js'])
    for (const hashed of Object.values(map)) expect(hashed).toMatch(HASHED)
    expect(readdirSync(join(dir, 'build')).sort()).toEqual([map['bundle.regl.js'], 'bundle.threejs.js.map', map['bundle.threejs.js']].sort())
    expect(read(map['main.js'])).toBe(`load("build/${map['bundle.regl.js']}"); load("build/${map['bundle.threejs.js']}")`)
    expect(read('index.html')).toBe(`<link href="${map['main.css']}"><script src="./${map['main.js']}"></script>`)
  })

  it('carries a leaf change into the entry hash', () => {
    app()
    const first = hashApp()
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'hash-assets-'))
    app()
    write('build/bundle.regl.js', 'regl v2')
    const second = hashApp()
    expect(second['bundle.threejs.js']).toBe(first['bundle.threejs.js'])
    expect(second['bundle.regl.js']).not.toBe(first['bundle.regl.js'])
    expect(second['main.js']).not.toBe(first['main.js'])
  })

  it('hashes an excluded asset as an entry, after the leaves it references', () => {
    write('assets/bundle.openscad.js', 'scad')
    write('assets/bundle.frame-worker.js', 'importScripts("bundle.openscad.js")')
    write('assets/manifold.wasm', 'wasm')
    write('frame.js', 'new Worker("assets/bundle.frame-worker.js")')
    write('index.html', '<script src="./frame.js"></script>')
    const worker = 'bundle.frame-worker.js'
    const map = hashAssetGraph(dir, { assets: 'assets', exclude: [worker], entries: [`assets/${worker}`, 'frame.js'], htmlRefs: ['frame.js'] })
    expect(read(`assets/${map[worker]}`)).toBe(`importScripts("${map['bundle.openscad.js']}")`)
    expect(read(map['frame.js'])).toBe(`new Worker("assets/${map[worker]}")`)
    expect(read('index.html')).toBe(`<script src="./${map['frame.js']}"></script>`)
    expect(readdirSync(join(dir, 'assets'))).toContain('manifold.wasm')
  })

  it('skips a missing entry and leaves its index.html ref alone', () => {
    write('build/bundle.regl.js', 'regl')
    write('main.js', 'x')
    write('index.html', '<link href="main.css"><script src="./main.js"></script>')
    const map = hashApp()
    expect(map['main.css']).toBeUndefined()
    expect(read('index.html')).toBe(`<link href="main.css"><script src="./${map['main.js']}"></script>`)
  })
})
