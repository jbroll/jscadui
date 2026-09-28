import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawImportPlugin } from '../src_build/rawImport.js'

describe('raw import plugin', () => {
  it('bundles a ?raw import as the file text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'))
    writeFileSync(join(dir, 'note.md'), '# note `x`\n')
    writeFileSync(join(dir, 'ex.js'), 'module.exports = { main }\n')
    writeFileSync(join(dir, 'entry.js'), "import note from './note.md?raw'\nimport ex from './ex.js?raw'\nexport default [note, ex]\n")
    const out = await esbuild.build({ entryPoints: [join(dir, 'entry.js')], bundle: true, write: false, format: 'esm', plugins: [rawImportPlugin] })
    const mod = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`)
    expect(mod.default).toEqual(['# note `x`\n', 'module.exports = { main }\n'])
  })
})
