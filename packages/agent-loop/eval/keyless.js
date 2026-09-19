// Keyless deterministic baseline: scripted providers emit known-good fluent
// sources while geometry and grading run for real. No key, no budget. The
// committed script plus test are the reference; JSON output regenerates.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createEvalBackend } from './backend.js'
import { fixture as bracket } from './fixtures/bracket.js'
import { fixture as cubeHole } from './fixtures/cube-hole.js'
import { fixture as gear } from './fixtures/gear.js'
import { formatTable } from './report.js'
import { runSuite } from './run-eval.js'

const CUBE_HOLE = `const jf = require('@jbroll/jscad-fluent')
function main() {
  const c = jf.cube({ size: 20 })
  const h = jf.cylinder({ radius: 5, height: 30 })
  return [jf.subtract(c, h)]
}
module.exports = { main }`

const GEAR = `const jf = require('@jbroll/jscad-fluent')
function main() {
  const disc = jf.cylinder({ radius: 17, height: 5 })
  const teeth = []
  for (let i = 0; i < 12; i++) teeth.push(jf.cuboid({ size: [4, 4, 5] }).translate([18, 0, 0]).rotateZ(i * Math.PI / 6))
  return [jf.union(disc, ...teeth)]
}
module.exports = { main }`

const BRACKET = `const jf = require('@jbroll/jscad-fluent')
function main() {
  const upright = jf.cuboid({ size: [60, 40, 8] })
  const foot = jf.cuboid({ size: [60, 8, 40] }).translate([0, -16, 16])
  return [jf.union(upright, foot)]
}
module.exports = { main }`

const roundsFor = (source, verify) => [
  [{ type: 'tool_use', id: 't1', name: 'eval', input: { source } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't2', name: verify, input: verify === 'check' ? { bed: [250, 210, 200] } : {} }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'tool_use', id: 't3', name: 'writeModel', input: { source, entry: 'main.js', message: 'baseline' } }, { type: 'done', stopReason: 'tool_use' }],
  [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
]

const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

export async function runKeylessBaseline() {
  const backend = createEvalBackend()
  const fixtures = [cubeHole, gear, bracket]
  const sources = { 'cube-hole': CUBE_HOLE, gear: GEAR, bracket: BRACKET }
  const verifies = { 'cube-hole': 'measure', gear: 'measure', bracket: 'check' }
  const rounds = fixtures.flatMap((f) => roundsFor(sources[f.name], verifies[f.name]))
  return runSuite(fixtures, { provider: scripted(rounds), backend })
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const results = await runKeylessBaseline()
  console.log(formatTable(results))
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(new URL(`./results/${stamp}-keyless.json`, import.meta.url), JSON.stringify({ model: 'keyless', results }, null, 2))
}
