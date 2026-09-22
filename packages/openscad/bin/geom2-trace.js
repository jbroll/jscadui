#!/usr/bin/env node

/**
 * geom2-trace - find the boolean operation that leaves a 2D geometry open.
 *
 * `linear_extrude` and friends call geom2.toOutlines(), which throws
 * "geometry is not closed at vertex x,y" when the side set does not form
 * closed loops. The throw names the extrusion, not the union / subtract /
 * intersect that produced the broken geometry. This wraps the three booleans
 * the runtime uses, checks every geom2 they return, and reports the first one
 * whose result is open, with the vertices left dangling.
 *
 * Usage:
 *   node packages/openscad/bin/geom2-trace.js model.scad [--engine jscad] [--lib-path <p>] [--fn <n>] [--all]
 */

import { resolve } from 'node:path'
import { initScadRuntime, evalScadSolidSync } from './run-jscad.js'

const parseArgs = (argv) => {
  const o = { input: null, libPaths: [], fn: 0, engine: 'jscad', all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--lib-path') o.libPaths.push(argv[++i])
    else if (a === '--fn') o.fn = Number(argv[++i])
    else if (a === '--engine') o.engine = argv[++i]
    else if (a === '--all') o.all = true
    else if (!o.input) o.input = a
    else throw new Error(`unknown arg: ${a}`)
  }
  return o
}

const key = (v) => `${v[0]},${v[1]}`

/**
 * Dangling vertices of a side set: those with an unequal number of sides
 * arriving and leaving. An empty list means every loop closes.
 */
export const danglingVertices = (sides) => {
  const balance = new Map()
  for (const [from, to] of sides) {
    balance.set(key(from), (balance.get(key(from)) ?? 0) + 1)
    balance.set(key(to), (balance.get(key(to)) ?? 0) - 1)
  }
  return [...balance].filter(([, n]) => n !== 0).map(([v, n]) => ({ vertex: v, balance: n }))
}

const nearest = (sides, vertex) => {
  const [vx, vy] = vertex.split(',').map(Number)
  let best = null
  for (const side of sides) {
    for (const p of side) {
      const d = Math.hypot(p[0] - vx, p[1] - vy)
      if (d > 0 && (best === null || d < best.d)) best = { d, point: p }
    }
  }
  return best
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.input) {
  console.error('usage: geom2-trace.js <model.scad> [--engine jscad|manifold] [--lib-path <p>] [--fn <n>] [--all]')
  process.exit(2)
}

const ctx = await initScadRuntime({ engine: opts.engine })
const { geom2 } = ctx.jscadModeling.geometries
const { measureEpsilon, measureBoundingBox } = ctx.jscadModeling.measurements

let reported = 0

const wrap = (name, fn) => (...args) => {
  const result = fn(...args)
  if (!geom2.isA(result)) return result
  const sides = geom2.toSides(result)
  const dangling = danglingVertices(sides)
  if (dangling.length === 0) return result
  if (reported === 0 || opts.all) {
    const inputs = args.flat(Infinity).filter((a) => geom2.isA(a))
    console.log(`\n${name}() returned an open geom2`)
    console.log(`  inputs: ${inputs.map((g) => `${geom2.toSides(g).length} sides`).join(', ')}`)
    console.log(`  output: ${sides.length} sides, ${dangling.length} dangling vertices`)
    console.log(`  epsilon: ${measureEpsilon(result)}`)
    console.log(`  bounds: ${JSON.stringify(measureBoundingBox(result))}`)
    for (const d of dangling.slice(0, 10)) {
      const near = nearest(sides, d.vertex)
      console.log(`    ${d.vertex}  balance=${d.balance > 0 ? '+' : ''}${d.balance}  nearest other point ${near ? near.d.toExponential(3) + ' away' : 'none'}`)
    }
    for (const g of inputs) {
      const bad = danglingVertices(geom2.toSides(g))
      if (bad.length) console.log(`  NOTE: an input was already open (${bad.length} dangling)`)
    }
  }
  reported++
  return result
}

for (const name of ['union', 'subtract', 'intersect']) {
  ctx.jscadModeling.booleans[name] = wrap(name, ctx.jscadModeling.booleans[name])
}
// initPrimitives() captured the originals, so re-inject to pick up the wrappers.
ctx.openscadRuntime.j$.init(ctx.jscadModeling)

try {
  evalScadSolidSync(resolve(opts.input), ctx, {
    fn: opts.fn, libPaths: opts.libPaths, raw: true,
  })
} catch (err) {
  console.log(`\nmodel threw: ${err.message}`)
}

console.log(`\n${reported} open geom2 result${reported === 1 ? '' : 's'} from booleans`)
