export function formatTable(results) {
  const lines = ['fixture  total  disc  rec  geom  cons']
  for (const { fixture, report } of results) {
    const d = report.dimensions
    lines.push(`${fixture}  ${report.total}  ${d.discipline}  ${d.recovery}  ${d.geometry}  ${d.conservation}`)
  }
  const total = results.reduce((a, r) => a + r.report.total, 0)
  lines.push(`suite  ${total} / ${results.length * 8}`)
  return lines.join('\n')
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const n2 = (x) => x.toFixed(2)

// Mean over the non-null/undefined values of an optional per-run field; null when none exist.
const meanOf = (runs, get) => {
  const vals = runs.map(get).filter((v) => v !== null && v !== undefined)
  return vals.length > 0 ? mean(vals) : null
}

export function summarize(results) {
  const byFixture = new Map()
  for (const r of results) {
    if (!byFixture.has(r.fixture)) byFixture.set(r.fixture, [])
    byFixture.get(r.fixture).push(r)
  }
  return [...byFixture].map(([fixture, runs]) => ({
    fixture,
    runs: runs.length,
    firstAttemptFailures: mean(runs.map((r) => r.report.firstAttemptFailures)),
    checkPassRate: mean(runs.map((r) => r.report.checkRate)),
    total: mean(runs.map((r) => r.report.total)),
    errors: runs.filter((r) => r.error).length,
    rounds: meanOf(runs, (r) => r.metrics?.rounds),
    failedCalls: meanOf(runs, (r) => r.metrics?.failedCalls),
    inputTokens: meanOf(runs, (r) => r.metrics?.inputTokens),
    outputTokens: meanOf(runs, (r) => r.metrics?.outputTokens),
    seconds: meanOf(runs, (r) => r.metrics?.seconds),
    geometryError: meanOf(runs, (r) => r.metrics?.geometryError),
    warnings: meanOf(runs, (r) => r.metrics?.warnings),
    docsCalls: meanOf(runs, (r) => r.metrics?.docsCalls),
  }))
}

const n2or = (x) => (x === null || x === undefined ? '-' : n2(x))

export function formatSummary(summary) {
  const lines = ['fixture  runs  firstFail  checks  total  errors']
  for (const s of summary) {
    lines.push(`${s.fixture}  ${s.runs}  ${n2(s.firstAttemptFailures)}  ${n2(s.checkPassRate)}  ${n2(s.total)}  ${s.errors}`)
  }
  lines.push('', 'fixture  rounds  failedCalls  inputTokens  outputTokens  seconds  geometryError  warnings  docsCalls')
  for (const s of summary) {
    lines.push(
      `${s.fixture}  ${n2or(s.rounds)}  ${n2or(s.failedCalls)}  ${n2or(s.inputTokens)}  ${n2or(s.outputTokens)}  ${n2or(s.seconds)}  ${n2or(s.geometryError)}  ${n2or(s.warnings)}  ${n2or(s.docsCalls)}`,
    )
  }
  return lines.join('\n')
}

export function formatComparison(a, b) {
  const lines = [
    `a: ${a.model} ${a.promptSha256?.slice(0, 8)}  b: ${b.model} ${b.promptSha256?.slice(0, 8)}`,
    'fixture  firstFail a → b  checks a → b  total a → b',
  ]
  const names = [...new Set([...a.summary, ...b.summary].map((s) => s.fixture))]
  const cell = (s, key) => (s ? n2or(s[key]) : '-')
  for (const name of names) {
    const sa = a.summary.find((s) => s.fixture === name)
    const sb = b.summary.find((s) => s.fixture === name)
    lines.push(
      `${name}  ${cell(sa, 'firstAttemptFailures')} → ${cell(sb, 'firstAttemptFailures')}  ${cell(sa, 'checkPassRate')} → ${cell(sb, 'checkPassRate')}  ${cell(sa, 'total')} → ${cell(sb, 'total')}`,
    )
  }
  lines.push('', 'fixture  rounds a → b  failedCalls a → b  seconds a → b  geometryError a → b  warnings a → b  docsCalls a → b')
  for (const name of names) {
    const sa = a.summary.find((s) => s.fixture === name)
    const sb = b.summary.find((s) => s.fixture === name)
    lines.push(
      `${name}  ${cell(sa, 'rounds')} → ${cell(sb, 'rounds')}  ${cell(sa, 'failedCalls')} → ${cell(sb, 'failedCalls')}  ${cell(sa, 'seconds')} → ${cell(sb, 'seconds')}  ${cell(sa, 'geometryError')} → ${cell(sb, 'geometryError')}  ${cell(sa, 'warnings')} → ${cell(sb, 'warnings')}  ${cell(sa, 'docsCalls')} → ${cell(sb, 'docsCalls')}`,
    )
  }
  return lines.join('\n')
}
