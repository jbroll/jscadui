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

export function firstAttemptFailures(transcript) {
  const names = new Map(toolCallsOf(transcript).map((c) => [c.id, c.name]))
  let count = 0
  for (const m of resultsOf(transcript)) {
    if (failed(m.content)) count += 1
    else if (names.get(m.toolCallId) === 'eval') return count
  }
  return count
}

const requiresWrite = (fixture) => fixture.requires?.includes('writeModel') === true

// The model a run is graded on: its last writeModel, or, for a fixture that
// does not require one, its last eval. Null when the run has neither.
export function gradedModel(fixture, transcript) {
  const calls = toolCallsOf(transcript)
  const last = (name) => calls.findLast((c) => c.name === name)
  const call = last('writeModel') ?? (requiresWrite(fixture) ? undefined : last('eval'))
  return call ? { source: call.input?.source, entry: call.input?.entry ?? 'main.js' } : null
}

// A run that stopped without a final reply before its turn cap: the provider
// sent nothing back. A capped run ends on a tool result after maxTurns replies.
export function endedWithoutReply(transcript, maxTurns) {
  if (transcript.length === 0 || transcript.at(-1).role === 'assistant') return false
  return transcript.filter((m) => m.role === 'assistant').length < maxTurns
}

// The transcript-based dimensions: everything except geometry, which needs the final measure.
export function gradeTranscript(fixture, transcript) {
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

  // No failures means nothing to recover from: full marks, same as a recovered run.
  let recovery = 2
  const failures = results.filter((r) => failed(r.content))
  if (failures.length > 0) {
    const lastFailureAt = transcript.lastIndexOf(failures[failures.length - 1])
    const laterSuccess = results
      .filter((r) => transcript.indexOf(r) > lastFailureAt)
      .some((r) => !failed(r.content))
    recovery = laterSuccess ? 2 : 0
  }

  const writes = names.filter((n) => n === 'writeModel').length
  const conservation = calls.length <= 12 && writes <= 2 ? 2 : calls.length <= 24 ? 1 : 0

  return {
    dimensions: { discipline, recovery, conservation },
    firstAttemptFailures: firstAttemptFailures(transcript),
  }
}

const warningsIn = (content) => {
  try {
    const warnings = JSON.parse(content)?.warnings
    return Array.isArray(warnings) ? warnings.length : 0
  } catch {
    return 0
  }
}

// All tool calls and all failed results in the run, unlike firstAttemptFailures
// which stops counting at the first successful eval.
export function transcriptMetrics(transcript) {
  const calls = toolCallsOf(transcript)
  const results = resultsOf(transcript)
  return {
    toolCalls: calls.length,
    failedCalls: results.filter((r) => failed(r.content)).length,
    warnings: results.reduce((n, r) => n + warningsIn(r.content), 0),
    docsCalls: calls.filter((c) => c.name === 'docs').length,
  }
}

const relativeError = (actual, target) => Math.abs(actual - target) / target

// Relative error against an optional fixture target ({ volume?, dimensions? });
// dimensions compare sorted ascending so orientation doesn't matter.
export function geometryError(target, measure) {
  if (!target || !measure) return null
  let maxError = null
  if (typeof target.volume === 'number') {
    maxError = relativeError(measure.volume ?? 0, target.volume)
  }
  if (Array.isArray(target.dimensions)) {
    const t = [...target.dimensions].sort((a, b) => a - b)
    const d = [...(measure.dimensions ?? [])].sort((a, b) => a - b)
    for (let i = 0; i < t.length; i += 1) {
      const err = relativeError(d[i] ?? 0, t[i])
      maxError = maxError === null ? err : Math.max(maxError, err)
    }
  }
  return maxError
}

// `finalMeasure` and `context` describe the gradedModel's geometry. A fixture
// that requires writeModel gets geometry 0 and checkRate 0 without one.
export function gradeFixture(fixture, transcript, finalMeasure, context = {}) {
  const { dimensions, firstAttemptFailures: faf } = gradeTranscript(fixture, transcript)
  const model = gradedModel(fixture, transcript)
  const unsaved = requiresWrite(fixture) && !model

  let rate = 0
  if (!unsaved) {
    const checksContext = { ...context, source: model?.source ?? '' }
    const outcomes = fixture.checks(finalMeasure, checksContext).map((c) => (c.pass ? 1 : 0))
    rate = outcomes.length === 0 ? 0 : outcomes.reduce((a, b) => a + b, 0) / outcomes.length
  }
  const geometry = rate === 1 ? 2 : rate >= 0.5 ? 1 : 0

  return {
    dimensions: { ...dimensions, geometry },
    total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
    firstAttemptFailures: faf,
    checkRate: rate,
    ...(unsaved ? { saved: false } : {}),
  }
}
