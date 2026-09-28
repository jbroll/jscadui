import { describe, it, expect } from 'vitest'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initScadRuntime, evalScadSolidSync } from '../bin/run-jscad.js'

const LIBERATION_TTF = fileURLToPath(new URL('../../jscad-text/src/fonts/data/LiberationSans-Regular.ttf', import.meta.url))

describe('run-jscad with use <font.ttf>', () => {
  it('loads the font file as bytes for j$.useFont', async () => {
    const ctx = await initScadRuntime()
    const dir = mkdtempSync(join(tmpdir(), 'use-font-'))
    copyFileSync(LIBERATION_TTF, join(dir, 'Sans.TTF'))
    const file = join(dir, 'main.scad')
    writeFileSync(file, 'use <Sans.TTF>\ntext("A", font="Liberation Sans:style=Regular");\n')
    const entities = evalScadSolidSync(file, ctx, { raw: true })
    expect(entities).toHaveLength(1)
  })
})
