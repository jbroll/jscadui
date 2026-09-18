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
