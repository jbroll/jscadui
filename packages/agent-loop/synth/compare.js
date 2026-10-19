import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatLogDir } from '../log/log-dir.js'

const mean = (values) => {
  const nums = values.filter((v) => typeof v === 'number')
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length
}

// A session without geometry passes nothing; a check-less scenario has no rate.
const passRate = (checks) => {
  if (!checks) return null
  return checks.total ? checks.passed / checks.total : 0
}

// Errored sessions are counted, not averaged: a crash after the first build
// would otherwise read as fewer turns and stumbles.
const statsOf = (sessions) => {
  const clean = sessions.filter((s) => !s.error)
  return {
    sessions: sessions.length,
    errors: sessions.length - clean.length,
    timedOut: sessions.filter((s) => s.timedOut).length,
    checkPassRate: mean(clean.map((s) => passRate(s.checks))),
    accepted: clean.filter((s) => s.accepted).length,
    meanUserTurns: mean(clean.map((s) => s.userTurns)),
    meanRounds: mean(clean.map((s) => s.rounds)),
    meanFailedCalls: mean(clean.map((s) => s.stumbles?.failedCalls)),
    meanUnbuiltTurns: mean(clean.map((s) => s.stumbles?.unbuiltTurns)),
    meanCorrections: mean(clean.map((s) => s.stumbles?.corrections)),
  }
}

const groupOf = (manifest) => {
  const groups = new Map()
  for (const s of manifest.sessions ?? []) {
    if (s.skipped) continue
    const key = `${s.scenario}|${s.builder}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  return groups
}

export const compareBatches = (a, b) => {
  const ga = groupOf(a)
  const gb = groupOf(b)
  const keys = [...new Set([...ga.keys(), ...gb.keys()])]
  return keys.map((key) => {
    const [scenario, builder] = key.split('|')
    return {
      scenario,
      builder,
      a: ga.has(key) ? statsOf(ga.get(key)) : null,
      b: gb.has(key) ? statsOf(gb.get(key)) : null,
    }
  })
}

const COLUMNS = [
  ['sessions', 'n'],
  ['errors', 'errors'],
  ['timedOut', 'timeouts'],
  ['checkPassRate', 'checks'],
  ['accepted', 'accepted'],
  ['meanUserTurns', 'turns'],
  ['meanRounds', 'rounds'],
  ['meanFailedCalls', 'failed'],
  ['meanUnbuiltTurns', 'unbuilt'],
  ['meanCorrections', 'corrections'],
]

const num = (v) => (v === null || v === undefined ? '-' : Number.isInteger(v) ? String(v) : v.toFixed(2))

export const formatCompare = (rows) => {
  const table = [
    ['scenario', 'builder', ...COLUMNS.map(([, label]) => label)],
    ...rows.map((r) => [r.scenario, r.builder, ...COLUMNS.map(([key]) => `${num(r.a?.[key])} -> ${num(r.b?.[key])}`)]),
  ]
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)))
  return table.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n')
}

const readManifest = (logDir, id) => {
  const path = join(logDir, 'synthetic', id, 'manifest.json')
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`synth:compare: cannot read batch manifest at ${path}: ${e.message}`)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [idA, idB] = process.argv.slice(2)
  const dir = chatLogDir()
  if (!idA || !idB) {
    console.error('usage: node synth/compare.js <batchA> <batchB>')
    process.exit(1)
  }
  if (!dir) {
    console.error('synth:compare: JSCAD_CHAT_LOG=0, logging is off')
    process.exit(1)
  }
  try {
    console.log(formatCompare(compareBatches(readManifest(dir, idA), readManifest(dir, idB))))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
