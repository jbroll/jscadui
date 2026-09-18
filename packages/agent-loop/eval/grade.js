const toolCallsOf = (transcript) =>
  transcript.filter((m) => m.role === 'assistant').flatMap((m) => m.toolCalls ?? [])

const resultsOf = (transcript) => transcript.filter((m) => m.role === 'tool')

const failed = (content) => {
  try {
    return JSON.parse(content)?.ok === false
  } catch {
    return false
  }
}

export function gradeFixture(fixture, transcript, finalMeasure) {
  const calls = toolCallsOf(transcript)
  const results = resultsOf(transcript)
  const names = calls.map((c) => c.name)

  let discipline = 0
  if (names.includes('eval')) {
    discipline = 1
    if (!fixture.verifyBeforeWrite) {
      discipline = 2
    } else {
      const firstWrite = names.indexOf('writeModel')
      const verified = names.slice(0, firstWrite).some((n) => n === 'measure' || n === 'check')
      if (firstWrite === -1 || verified) discipline = 2
    }
  }

  let recovery = 1
  const failures = results.filter((r) => failed(r.content))
  if (failures.length > 0) {
    const lastFailureAt = transcript.lastIndexOf(failures[failures.length - 1])
    const laterSuccess = results
      .filter((r) => transcript.indexOf(r) > lastFailureAt)
      .some((r) => !failed(r.content))
    recovery = laterSuccess ? 2 : 0
  }

  const outcomes = fixture.checks(finalMeasure).map((c) => (c.pass ? 1 : 0))
  const rate = outcomes.length === 0 ? 0 : outcomes.reduce((a, b) => a + b, 0) / outcomes.length
  const geometry = rate === 1 ? 2 : rate >= 0.5 ? 1 : 0

  const writes = names.filter((n) => n === 'writeModel').length
  const conservation = calls.length <= 12 && writes <= 2 ? 2 : calls.length <= 24 ? 1 : 0

  return { dimensions: { discipline, recovery, geometry, conservation }, total: discipline + recovery + geometry + conservation }
}
