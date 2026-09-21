#!/usr/bin/env node

/**
 * display-check - run a .scad model and report entities the browser's display
 * conversion rejects.
 *
 * The STL corpus unions main()'s result, so anything that is not geometry is
 * either absorbed or reported as a union error. The browser instead hands every
 * entity to JscadToCommon, which throws "invalid jscad geometry, not an object"
 * on the first non-object. This reproduces that path in Node.
 *
 * Usage:
 *   node packages/openscad/bin/display-check.js model.scad [--preview] [--engine jscad] [--lib-path <p>]
 */

import { resolve } from 'node:path'
import { JscadToCommon } from '../../format-jscad/index.js'
import { initScadRuntime, evalScadSolidSync } from './run-jscad.js'

function parseArgs(argv) {
  const o = { input: null, preview: false, libPaths: [], fn: 0, engine: 'manifold' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--preview') o.preview = true
    else if (a === '--lib-path') o.libPaths.push(argv[++i])
    else if (a === '--fn') o.fn = Number(argv[++i])
    else if (a === '--engine') o.engine = argv[++i]
    else if (!o.input) o.input = a
    else throw new Error(`unknown arg: ${a}`)
  }
  return o
}

function describe(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  const t = typeof v
  if (t === 'symbol') return `symbol ${String(v)}`
  if (t !== 'object') return `${t} ${JSON.stringify(v)?.slice(0, 120)}`
  return `${v.constructor?.name ?? 'Object'} keys=[${Object.keys(v).slice(0, 8).join(',')}]`
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.input) {
  console.error('usage: display-check.js <model.scad> [--preview] [--engine jscad|manifold] [--lib-path <p>] [--fn <n>]')
  process.exit(2)
}

const ctx = await initScadRuntime({ engine: opts.engine })
const entities = evalScadSolidSync(resolve(opts.input), ctx, {
  fn: opts.fn, libPaths: opts.libPaths, preview: opts.preview, raw: true,
})

if (!entities) {
  console.log('no geometry returned from main()')
  process.exit(0)
}

console.log(`${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}`)
const bad = []
entities.forEach((e, i) => {
  try {
    const obj = JscadToCommon(e, [], false)
    if (!obj || obj.type === 'unknown') bad.push({ i, why: 'unknown type', e })
  } catch (err) {
    bad.push({ i, why: err.message, e })
  }
})

if (bad.length === 0) {
  console.log('all entities convert')
  process.exit(0)
}
console.log(`${bad.length} rejected:`)
for (const b of bad.slice(0, 20)) console.log(`  [${b.i}] ${b.why} — ${describe(b.e)}`)
process.exit(1)
