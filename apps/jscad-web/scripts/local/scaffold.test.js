// apps/jscad-web/scripts/local/scaffold.test.js
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldStarter } from './scaffold.js'

describe('scaffoldStarter', () => {
  it('writes index.js into an empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jscad-scaffold-'))
    const r = scaffoldStarter(dir)
    expect(r).toEqual({ entryFile: 'index.js', created: true })
    const src = readFileSync(join(dir, 'index.js'), 'utf-8')
    expect(src).toContain('main')
    expect(src).toContain("require('@jscad/modeling')")
  })
  it('does not overwrite an existing entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jscad-scaffold-'))
    writeFileSync(join(dir, 'mine.js'), 'mine')
    expect(scaffoldStarter(dir)).toBeNull()
  })
})
