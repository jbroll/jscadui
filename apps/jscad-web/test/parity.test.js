import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, test } from 'vitest'
import { measure } from '@jscadui/model-tools'

// The fixtures, the CLI, and the model loader come from the sibling
// jscad-ai-studio checkout; JSCAD_AI_STUDIO_PATH points at a checkout elsewhere.
// Parity is skipped when the checkout is absent so CI without it still passes.
const STUDIO_ROOT = process.env.JSCAD_AI_STUDIO_PATH ?? '/home/john/src/jscad-ai-studio'
const FIXTURES_DIR = join(STUDIO_ROOT, 'test/fixtures')
const WORK_BIN = join(STUDIO_ROOT, 'bin/jscad-work.js')
const STUDIO_AVAILABLE = existsSync(FIXTURES_DIR) && existsSync(WORK_BIN)
const execFileAsync = promisify(execFile)

// Not models or deliberately broken: init-signal-* drive init, broken.* throw,
// infinite never returns, *.json/*.md are data. The e2e suite covers the
// timeout case; parity covers every fixture that produces geometry.
const SKIP = new Set([
  'init-signal-child.js',
  'init-signal-driver.js',
  'broken.js',
  'broken.scad',
  'infinite.js',
])

const fixtures = () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => /\.(js|scad)$/.test(f) && !SKIP.has(f))
  files.push('assembly/top.js')
  return files.sort()
}

if (STUDIO_AVAILABLE) {
  describe('frame measure parity with jscad-work', () => {
    // The worker's jscadMain flattens the model's return into solids with this
    // flatten (the worker package's own), then measures one solid as a single
    // geometry and more as a scene array. @jscadui/worker registers self error
    // listeners at import time, which the Node test env has no self for, so it
    // is imported behind a stub.
    let flatten
    let loadAndRun
    let initOpenscad
    let registerScadRequire

    beforeAll(async () => {
      const prevSelf = globalThis.self
      globalThis.self = { addEventListener() {} }
      try {
        ;({ flatten } = await import('@jscadui/worker'))
        ;({ loadAndRun } = await import(join(STUDIO_ROOT, 'lib/model-loader.js')))
        ;({ initOpenscad, registerScadRequire } = await import(join(STUDIO_ROOT, 'lib/openscad.js')))
      } finally {
        globalThis.self = prevSelf
      }
      // combo.js and cube.scad require the OpenSCAD runtime; the CLI worker
      // does the same init before running.
      await initOpenscad()
      registerScadRequire()
    })

    for (const fixture of fixtures()) {
      test(`${fixture} measures identically to the CLI`, { timeout: 60000 }, async () => {
        const file = join(FIXTURES_DIR, fixture)
        const { stdout } = await execFileAsync(process.execPath, [WORK_BIN, 'measure', file], {
          timeout: 20000,
        })
        const cli = JSON.parse(stdout)
        expect(cli.ok).toBe(true)

        const run = loadAndRun(file, {})
        expect(run.ok).toBe(true)

        const solids = flatten(run.geom)
        // Classification parity: the frame measures one flattened solid as a
        // single geometry and more as an array, and the CLI reports geomType
        // 'array' whenever the model returned an array. Every fixture returns
        // one geometry or an array of several, so the two must agree. Deep
        // equality cannot assert this: measureArray([one]) equals
        // measureGeom(one).
        expect(solids.length !== 1).toBe(cli.geomType === 'array')

        expect(measure(solids.length === 1 ? solids[0] : solids, {})).toEqual(cli.measure)
      })
    }
  })
} else {
  describe.skip('frame measure parity with jscad-work', () => {
    test('skipped: jscad-ai-studio checkout not found; set JSCAD_AI_STUDIO_PATH', () => {})
  })
}
