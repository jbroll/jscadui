// A baseline lists only failures, as { rel, status, cells?, why?, flaky? }. Cells
// compare by url alone: their messages carry wasm offsets and stack detail.

const cellUrl = (cell) => cell.split(': ')[0]

/** A result in the shape a baseline records it. */
export const toFailure = (r) => {
  const f = { rel: r.rel, status: r.status }
  if (r.cellFailures?.length) f.cells = r.cellFailures
  if (r.errText) f.why = r.errText
  return f
}

/**
 * @param {{failures: Array<{rel:string,status:string,cells?:string[],flaky?:boolean}>}} baseline
 * @param {Array<{rel:string,status:string,cellFailures?:string[]}>} results
 * @returns {{regressions: string[], fixed: string[]}}
 */
export const diffAgainstBaseline = (baseline, results) => {
  const known = new Map(baseline.failures.map((f) => [f.rel, f]))
  const regressions = []
  const fixed = []
  for (const r of results) {
    const b = known.get(r.rel)
    if (r.status === 'ok') {
      if (b && !b.flaky) fixed.push(`${r.rel} (was ${b.status})`)
      continue
    }
    if (!b) {
      regressions.push(`new ${r.status}: ${r.rel}`)
      continue
    }
    if (b.status !== r.status) {
      regressions.push(`${b.status} -> ${r.status}: ${r.rel}`)
      continue
    }
    const was = new Set((b.cells ?? []).map(cellUrl))
    const now = new Set((r.cellFailures ?? []).map(cellUrl))
    for (const cell of now) if (!was.has(cell)) regressions.push(`new dead cell in ${r.rel}: ${cell}`)
    for (const cell of was) if (!now.has(cell)) fixed.push(`${r.rel}: cell ${cell}`)
  }
  return { regressions, fixed }
}
