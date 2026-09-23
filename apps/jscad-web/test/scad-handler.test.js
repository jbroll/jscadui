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
