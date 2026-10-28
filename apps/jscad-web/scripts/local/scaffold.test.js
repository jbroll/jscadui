// apps/jscad-web/scripts/local/scaffold.test.js
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../test/tempDir.js'
import { scaffoldStarter } from './scaffold.js'

describe('scaffoldStarter', () => {
  it('writes index.js into an empty dir', () => {
    const dir = tempDir('jscad-scaffold-')
    const r = scaffoldStarter(dir)
    expect(r).toEqual({ entryFile: 'index.js', created: true })
    const src = readFileSync(join(dir, 'index.js'), 'utf-8')
    expect(src).toContain('main')
    expect(src).toContain("require('@jscad/modeling')")
  })
  it('does not overwrite an existing entry', () => {
    const dir = tempDir('jscad-scaffold-')
    writeFileSync(join(dir, 'mine.js'), 'mine')
    expect(scaffoldStarter(dir)).toBeNull()
  })
})
