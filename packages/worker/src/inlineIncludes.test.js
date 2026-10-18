import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultRoots, inlineIncludes } from './inlineIncludes.js'

const readFile = (p) => {
  try { return readFileSync(p, 'utf8') } catch { return undefined }
}

describe('inlineIncludes', () => {
  it('inlines a sibling relative include', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inc-'))
    writeFileSync(join(dir, 'lib.jscad'), 'function helper() { return 42; }')
    writeFileSync(join(dir, 'main.jscad'), 'include("./lib.jscad");\nfunction main() { return helper(); }')
    const out = inlineIncludes(readFile(join(dir, 'main.jscad')), join(dir, 'main.jscad'), { readFile })
    expect(out).toContain('function helper()')
    expect(out).not.toMatch(/^\s*include\(/m)
  })

  it('resolves absolute includes against library roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inc-'))
    mkdirSync(join(dir, 'library', 'mechanics'), { recursive: true })
    mkdirSync(join(dir, 'models'), { recursive: true })
    writeFileSync(join(dir, 'library', 'mechanics', 'part.jscad'), 'var PART = 7;')
    writeFileSync(join(dir, 'models', 'm.jscad'), 'include("/mechanics/part.jscad");\nvar x = PART;')
    const out = inlineIncludes(readFile(join(dir, 'models', 'm.jscad')), join(dir, 'models', 'm.jscad'), { readFile })
    expect(out).toContain('var PART = 7;')
  })

  it('inlines transitively and includes once on cycles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inc-'))
    writeFileSync(join(dir, 'a.jscad'), 'include("./b.jscad");\nvar A = 1;')
    writeFileSync(join(dir, 'b.jscad'), 'include("./a.jscad");\nvar B = 2;')
    const out = inlineIncludes(readFile(join(dir, 'a.jscad')), join(dir, 'a.jscad'), { readFile })
    expect(out).toContain('var A = 1;')
    expect(out).toContain('var B = 2;')
    expect(out).toContain('already included')
  })

  it('throws a descriptive error when unresolvable', () => {
    expect(() => inlineIncludes('include("./nope.jscad");', '/tmp/x.jscad', { readFile }))
      .toThrow(/cannot resolve '.\/nope\.jscad'/)
  })

  it('ignores include-like text inside other code', () => {
    const src = 'var s = "include(\\"x\\")"; // not a directive\nvar y = 1;'
    expect(inlineIncludes(src, '/tmp/x.jscad', { readFile })).toBe(src)
  })

  it('ignores directives inside block comments', () => {
    const src = '/*\nExample:\ninclude("./lib.jscad");\n*/\nvar y = 1;'
    expect(inlineIncludes(src, '/tmp/x.jscad', { readFile })).toBe(src)
  })

  it('skips SPA-rewrite HTML and resolves a later root', () => {
    // Production Apache answers unknown paths with index.html (HTTP 200), so
    // the first candidate root "finds" markup. Resolution must keep going to
    // the ancestor library root instead of inlining the HTML (which evals to
    // `Unexpected token '<'`). Mirrors plate01.jscad's include('/mechanics/…').
    const files = {
      '/t/models/m.jscad': 'include("/mechanics/part.jscad");\nvar x = PART;',
      '/t/library/mechanics/part.jscad': 'var PART = 7;',
    }
    const spaReadFile = (p) => (files[p] ?? '<!DOCTYPE html>\n<html><body>app</body></html>')
    const out = inlineIncludes(files['/t/models/m.jscad'], '/t/models/m.jscad', { readFile: spaReadFile })
    expect(out).toContain('var PART = 7;')
    expect(out).not.toContain('<!DOCTYPE')
  })

  it('throws cannot-resolve when every root serves markup', () => {
    const spaReadFile = () => '<!DOCTYPE html>\n<html></html>'
    expect(() => inlineIncludes('include("/mechanics/gone.jscad");', '/t/models/m.jscad', { readFile: spaReadFile }))
      .toThrow(/cannot resolve '\/mechanics\/gone\.jscad'/)
  })
})

describe('defaultRoots', () => {
  it('finds the nearest ancestor library dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inc-'))
    mkdirSync(join(dir, 'library'), { recursive: true })
    mkdirSync(join(dir, 'models', 'sub'), { recursive: true })
    const libReal = join(dir, 'library')
    const roots = defaultRoots(join(dir, 'models', 'sub', 'm.jscad'), (p) => p === libReal)
    expect(roots[0]).toBe(join(dir, 'models', 'sub'))
    expect(roots).toContain(libReal)
  })

  it('offers every ancestor library without a probe', () => {
    const roots = defaultRoots('/a/b/c/m.jscad')
    expect(roots[0]).toBe('/a/b/c')
    expect(roots).toContain('/a/b/library')
    expect(roots).toContain('/a/library')
  })
})
