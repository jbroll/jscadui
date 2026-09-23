import { describe, it, expect, vi } from 'vitest'
import { createScadHandler } from '../src_frame/scadHandler.js'

const APP = 'https://app.example'

// A transpiler that includes each name in `includes` from the file being
// transpiled, then from whatever that include resolved to, depth first.
const fakeOpenscad = (includes = {}) => ({
  parse: (source) => ({ ast: { source }, errors: [] }),
  transpile: (ast, { fileResolver, currentFile }, shared) => {
    const files = new Map()
    const errors = []
    const walk = (from, source) => {
      for (const name of includes[source] ?? []) {
        const resolved = fileResolver(name, from)
        if (!resolved) {
          errors.push({ code: 'FILE_NOT_FOUND', message: `Cannot resolve file: ${name}` })
          continue
        }
        files.set(resolved.path, { code: `// ${resolved.content}` })
        walk(resolved.path, resolved.content)
      }
    }
    walk(currentFile, ast.source)
    shared.set(currentFile, true)
    return { code: `// ${ast.source}`, errors, files }
  },
})

const setup = (includes) => {
  const openscad = fakeOpenscad(includes)
  const scad = createScadHandler({ getOpenscad: () => openscad, getAppOrigin: () => APP })
  return scad
}

describe('failed include reads', () => {
  const files = {}
  const readFile = vi.fn((url) => {
    if (url in files) return files[url]
    throw new Error(`file not found ${url}`)
  })
  const entry = 'http://project.local/main.scad'
  const lib = 'http://project.local/lib.scad'

  it('are forgotten once the files change', () => {
    const scad = setup({ main: ['lib.scad'] })
    expect(() => scad.handle('main', entry, readFile)).toThrow(/Cannot resolve file: lib.scad/)

    files[lib] = 'lib'
    expect(() => scad.handle('main', entry, readFile)).toThrow(/Cannot resolve file/)

    scad.clearFailures()
    expect(scad.handle('main', entry, readFile)).toBe('// main')
  })
})

describe('include origins', () => {
  const reader = (files) => vi.fn((url) => {
    if (url in files) return files[url]
    throw new Error(`file not found ${url}`)
  })

  it('resolves an include of an include against the origin it came from', () => {
    const scad = setup({ main: ['https://lib.example/a/one.scad'], one: ['two.scad'] })
    const readFile = reader({
      'https://lib.example/a/one.scad': 'one',
      'https://lib.example/a/two.scad': 'two',
    })
    expect(scad.handle('main', 'https://app.example/examples/main.scad', readFile)).toBe('// main')
    expect(readFile).toHaveBeenCalledWith('https://lib.example/a/two.scad')
  })

  it('names a cross-origin include by its full url so require fetches it from there', () => {
    const openscad = fakeOpenscad({ main: ['https://lib.example/a/one.scad'] })
    const transpile = vi.spyOn(openscad, 'transpile')
    const scad = createScadHandler({ getOpenscad: () => openscad, getAppOrigin: () => APP })
    scad.handle('main', 'https://app.example/examples/main.scad', reader({ 'https://lib.example/a/one.scad': 'one' }))
    const [, { currentFile }] = transpile.mock.calls[0]
    expect(currentFile).toBe('/examples/main.scad')
    expect([...transpile.mock.results[0].value.files.keys()]).toEqual(['https://lib.example/a/one.scad'])
  })

  it('keeps a same-origin include as a bare path', () => {
    const openscad = fakeOpenscad({ main: ['lib.scad'] })
    const transpile = vi.spyOn(openscad, 'transpile')
    const scad = createScadHandler({ getOpenscad: () => openscad, getAppOrigin: () => APP })
    scad.handle('main', 'http://project.local/main.scad', reader({ 'http://project.local/lib.scad': 'lib' }))
    expect([...transpile.mock.results[0].value.files.keys()]).toEqual(['/lib.scad'])
  })

  it('does not serve one origin a file transpiled from another with the same path', () => {
    const scad = setup()
    expect(scad.handle('A', 'https://a.example/m.scad', reader({}))).toBe('// A')
    expect(scad.handle('B', 'https://b.example/m.scad', reader({}))).toBe('// B')
  })

  it('serves an include from the cache under its full url, and forgets it by project path', () => {
    const openscad = fakeOpenscad({ main: ['lib.scad'] })
    const transpile = vi.spyOn(openscad, 'transpile')
    const scad = createScadHandler({ getOpenscad: () => openscad, getAppOrigin: () => APP })
    const readFile = reader({ 'http://project.local/lib.scad': 'lib' })
    scad.handle('main', 'http://project.local/main.scad', readFile)

    expect(scad.handle('lib', 'http://project.local/lib.scad', readFile)).toBe('// lib')
    expect(transpile).toHaveBeenCalledTimes(1)

    scad.forgetFiles(['/lib.scad'], 'http://project.local/')
    scad.handle('lib', 'http://project.local/lib.scad', readFile)
    expect(transpile).toHaveBeenCalledTimes(2)
  })
})
