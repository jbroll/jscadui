import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, test } from 'vitest'
import { measure } from '@jscadui/model-tools'
import { loadAndRun } from '/home/john/src/jscad-ai-studio/lib/model-loader.js'
import { initOpenscad, registerScadRequire } from '/home/john/src/jscad-ai-studio/lib/openscad.js'

const FIXTURES_DIR = '/home/john/src/jscad-ai-studio/test/fixtures'
const WORK_BIN = '/home/john/src/jscad-ai-studio/bin/jscad-work.js'
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

// The worker's jscadMain flattens the model's return into solids; the frame's
// measure handler then treats one solid as a single geometry, more as a scene
// array. That is the CLI's classification rule, so parity needs the same one.
const flatten = (value) => {
  const out = []
  const push = (v) => (v instanceof Array ? v.forEach(push) : out.push(v))
  push(value)
  return out
}

const frameMeasure = (geom) => {
  const solids = flatten(geom)
  return measure(solids.length === 1 ? solids[0] : solids, {})
}

const fixtures = () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => /\.(js|scad)$/.test(f) && !SKIP.has(f))
  files.push('assembly/top.js')
  return files.sort()
}

beforeAll(async () => {
  // combo.js and cube.scad require the OpenSCAD runtime; the CLI worker does
  // the same init before running.
  await initOpenscad()
  registerScadRequire()
})

describe('frame measure parity with jscad-work', () => {
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
      expect(frameMeasure(run.geom)).toEqual(cli.measure)
    })
  }
})