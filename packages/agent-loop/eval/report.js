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

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Mean over the non-null/undefined values of an optional per-run field; null when none exist.
const meanOf = (runs, get) => {
  const vals = runs.map(get).filter((v) => v !== null && v !== undefined)
  return vals.length > 0 ? mean(vals) : null
}

// Speed totals over every run in a result file: sums for wall/provider/tool time
// (tool time is the difference, not stored), medians for the per-call rates.
export function computeSpeed(results) {
  const seconds = results.map((r) => r.metrics?.seconds).filter((v) => typeof v === 'number')
  const providerSeconds = results.map((r) => r.metrics?.providerSeconds).filter((v) => typeof v === 'number')
  const toolSeconds = results
    .filter((r) => typeof r.metrics?.seconds === 'number' && typeof r.metrics?.providerSeconds === 'number')
    .map((r) => r.metrics.seconds - r.metrics.providerSeconds)
  const firstTokenSeconds = results.map((r) => r.metrics?.firstTokenSeconds).filter((v) => v !== null && v !== undefined)
  const outputTokensPerSecond = results
    .map((r) => r.metrics?.outputTokensPerSecond)
    .filter((v) => v !== null && v !== undefined)
  return {
    wallSeconds: seconds.reduce((a, b) => a + b, 0),
    providerSeconds: providerSeconds.reduce((a, b) => a + b, 0),
    toolSeconds: toolSeconds.reduce((a, b) => a + b, 0),
    medianFirstTokenSeconds: firstTokenSeconds.length ? median(firstTokenSeconds) : null,
    medianOutputTokensPerSecond: outputTokensPerSecond.length ? median(outputTokensPerSecond) : null,
    runs: results.length,
  }
}

// One line of speed totals for a report; '-' when the file predates speed metrics.
const formatSpeedLine = (speed, model, provider) => {
  if (!speed) return `speed: model ${model} via ${provider}  -`
  const first = speed.medianFirstTokenSeconds === null ? '-' : `${speed.medianFirstTokenSeconds.toFixed(1)}s`
  const tokPerSec = speed.medianOutputTokensPerSecond === null ? '-' : `${Math.round(speed.medianOutputTokensPerSecond)} tok/s`
  return (
    `speed: model ${model} via ${provider}  wall ${Math.round(speed.wallSeconds)}s  ` +
    `provider ${Math.round(speed.providerSeconds)}s  tools ${Math.round(speed.toolSeconds)}s  ` +
    `first token ${first} (median)  ${tokPerSec} (median)`
  )
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
    providerSeconds: meanOf(runs, (r) => r.metrics?.providerSeconds),
    firstTokenSeconds: meanOf(runs, (r) => r.metrics?.firstTokenSeconds),
    outputTokensPerSecond: meanOf(runs, (r) => r.metrics?.outputTokensPerSecond),
    reasoningTokens: meanOf(runs, (r) => r.metrics?.reasoningTokens),
  }))
}

const n2or = (x) => (x === null || x === undefined ? '-' : n2(x))

export function formatSummary(summary, speed) {
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
  lines.push('', 'fixture  providerSeconds  firstTokenSeconds  outputTokensPerSecond  reasoningTokens')
  for (const s of summary) {
    lines.push(
      `${s.fixture}  ${n2or(s.providerSeconds)}  ${n2or(s.firstTokenSeconds)}  ${n2or(s.outputTokensPerSecond)}  ${n2or(s.reasoningTokens)}`,
    )
  }
  if (speed) lines.push('', formatSpeedLine(speed, speed.model, speed.provider))
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
  lines.push(
    '',
    'fixture  rounds a → b  failedCalls a → b  seconds a → b  geometryError a → b  warnings a → b  docsCalls a → b  providerSeconds a → b  outputTokensPerSecond a → b',
  )
  for (const name of names) {
    const sa = a.summary.find((s) => s.fixture === name)
    const sb = b.summary.find((s) => s.fixture === name)
    lines.push(
      `${name}  ${cell(sa, 'rounds')} → ${cell(sb, 'rounds')}  ${cell(sa, 'failedCalls')} → ${cell(sb, 'failedCalls')}  ${cell(sa, 'seconds')} → ${cell(sb, 'seconds')}  ${cell(sa, 'geometryError')} → ${cell(sb, 'geometryError')}  ${cell(sa, 'warnings')} → ${cell(sb, 'warnings')}  ${cell(sa, 'docsCalls')} → ${cell(sb, 'docsCalls')}  ${cell(sa, 'providerSeconds')} → ${cell(sb, 'providerSeconds')}  ${cell(sa, 'outputTokensPerSecond')} → ${cell(sb, 'outputTokensPerSecond')}`,
    )
  }
  lines.push('', formatSpeedLine(a.speed, a.model, a.provider), formatSpeedLine(b.speed, b.model, b.provider))
  return lines.join('\n')
}
