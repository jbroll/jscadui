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

// Like the real transpiler: an include is inlined, a file already in the shared
// cache is not compiled again, and the shared cache comes back as `files`.
const inliningOpenscad = (compiled = []) => ({
  parse: (source) => ({ ast: { source }, errors: [] }),
  transpile: (ast, { fileResolver, currentFile }, shared) => {
    const compile = (path, source) => {
      compiled.push(path)
      const [text, ...includes] = source.split(' include ')
      const parts = [text]
      for (const name of includes) {
        const resolved = fileResolver(name, path)
        if (!shared.has(resolved.path)) compile(resolved.path, resolved.content)
        parts.push(shared.get(resolved.path).code)
      }
      shared.set(path, { code: parts.join('+') })
    }
    compile(currentFile, ast.source)
    return { code: shared.get(currentFile).code, errors: [], files: shared }
  },
})

describe('shared transpiler cache', () => {
  const reader = (files) => (url) => {
    if (url in files) return files[url]
    throw new Error(`file not found ${url}`)
  }
  const project = 'http://project.local'

  it('keeps an app file apart from a project file with the same path', () => {
    const scad = createScadHandler({ getOpenscad: inliningOpenscad, getAppOrigin: () => APP })
    const readFile = reader({
      [`${project}/demo/lib.scad`]: 'project-lib',
      [`${APP}/demo/lib.scad`]: 'app-lib',
    })
    expect(scad.handle('main include lib.scad', `${project}/demo/main.scad`, readFile)).toBe('main+project-lib')
    expect(scad.handle('main include lib.scad', `${APP}/demo/main.scad`, readFile)).toBe('main+app-lib')
    expect(scad.handle('app-lib', `${APP}/demo/lib.scad`, readFile)).toBe('app-lib')
  })

  it('drops a project file and its includers when the file is edited', () => {
    const scad = createScadHandler({ getOpenscad: inliningOpenscad, getAppOrigin: () => APP })
    const files = { [`${project}/lib.scad`]: 'lib-v1' }
    const readFile = reader(files)
    expect(scad.handle('main include lib.scad', `${project}/main.scad`, readFile)).toBe('main+lib-v1')

    files[`${project}/lib.scad`] = 'lib-v2'
    scad.forgetFiles(['/lib.scad'], `${project}/`)
    expect(scad.handle('main include lib.scad', `${project}/main.scad`, readFile)).toBe('main+lib-v2')
  })

  it('keeps a file from another origin across a project edit', () => {
    const compiled = []
    const openscad = inliningOpenscad(compiled)
    const scad = createScadHandler({ getOpenscad: () => openscad, getAppOrigin: () => APP })
    const files = {
      [`${project}/lib.scad`]: 'lib-v1',
      'https://lib.example/std.scad': 'std',
    }
    const readFile = reader(files)
    scad.handle('main include lib.scad include https://lib.example/std.scad', `${project}/main.scad`, readFile)

    files[`${project}/lib.scad`] = 'lib-v2'
    scad.forgetFiles(['/lib.scad'], `${project}/`)
    compiled.length = 0
    expect(scad.handle('main include lib.scad include https://lib.example/std.scad', `${project}/main.scad`, readFile))
      .toBe('main+lib-v2+std')
    expect(compiled).toEqual(['/main.scad', '/lib.scad'])
  })

  it('starts empty after the caches are cleared', () => {
    const scad = createScadHandler({ getOpenscad: inliningOpenscad, getAppOrigin: () => APP })
    const files = { [`${project}/lib.scad`]: 'lib-a' }
    const readFile = reader(files)
    scad.handle('main include lib.scad', `${project}/main.scad`, readFile)

    files[`${project}/lib.scad`] = 'lib-b'
    scad.clearTranspiled()
    expect(scad.handle('main include lib.scad', `${project}/main.scad`, readFile)).toBe('main+lib-b')
  })
})
