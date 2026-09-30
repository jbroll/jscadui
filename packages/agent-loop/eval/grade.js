import { applyEdit, applyWrite, resolveEntry } from '../src/project.js'

const toolCallsOf = (transcript) =>
  transcript.filter((m) => m.role === 'assistant').flatMap((m) => m.toolCalls ?? [])

const resultsOf = (transcript) => transcript.filter((m) => m.role === 'tool')

const parsed = (content) => {
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

const failed = (content) => parsed(content)?.ok === false

// Result files written before the project tools hold `eval` (a trial run) and
// `writeModel` (a save of `source` to `entry`, main.js by default).
const LEGACY_ENTRY = 'main.js'
const SAVES = new Set(['write', 'edit', 'writeModel'])
const TRIALS = new Set(['eval', 'run'])
const BUILDS = new Set(['eval', 'write', 'edit'])

// Failed results before the first successful build (or legacy eval).
export function firstAttemptFailures(transcript) {
  const names = new Map(toolCallsOf(transcript).map((c) => [c.id, c.name]))
  let count = 0
  for (const m of resultsOf(transcript)) {
    if (failed(m.content)) count += 1
    else if (BUILDS.has(names.get(m.toolCallId))) return count
  }
  return count
}

// A fixture requiring `write` is satisfied by a write or an edit (or a legacy writeModel).
const requiresWrite = (fixture) => fixture.requires?.some((name) => name === 'write' || name === 'writeModel') === true

export const GRADE_TIMEOUT_MS = 120_000

// Replays the run's saves over the fixture's files, the same way the backend
// applied them: a write or edit the backend refused changes nothing.
const replaySaves = (fixture, calls) => {
  let files = { ...fixture.files }
  let saved = false
  let legacyLast
  for (const { name, input } of calls) {
    try {
      if (name === 'write') files = applyWrite(files, input).files
      else if (name === 'edit') files = applyEdit(files, input).files
      else if (name === 'writeModel') {
        legacyLast = input?.entry ?? LEGACY_ENTRY
        files = { ...files, [legacyLast]: input?.source }
      } else continue
      saved = true
    } catch {
      // refused: the project is as it was
    }
  }
  return { files, saved, legacyLast }
}

// The project a run is graded on, `{ files, entry }`: the fixture's files with
// every save applied, the entry resolved Node style (a legacy run with no
// entry file falls back to its last writeModel). Without a save, a fixture
// that does not require one is graded on its legacy last eval, else on its own
// files. Null when there is nothing to grade.
export function gradedModel(fixture, transcript) {
  const calls = toolCallsOf(transcript)
  const { files, saved, legacyLast } = replaySaves(fixture, calls)
  if (saved) return { files, entry: resolveEntry(files) ?? legacyLast ?? null }
  if (requiresWrite(fixture)) return null
  const lastEval = calls.findLast((c) => c.name === 'eval')
  if (lastEval) {
    const entry = lastEval.input?.entry ?? LEGACY_ENTRY
    return { files: { ...files, [entry]: lastEval.input?.source }, entry }
  }
  return Object.keys(files).length > 0 ? { files, entry: resolveEntry(files) } : null
}

// A run that stopped without a final reply before its turn cap: the provider
// sent nothing back. A capped run ends on a tool result after maxTurns replies.
export function endedWithoutReply(transcript, maxTurns) {
  if (transcript.length === 0 || transcript.at(-1).role === 'assistant') return false
  return transcript.filter((m) => m.role === 'assistant').length < maxTurns
}

// A run the turn cap ended: its last round's tool results got no reply.
const hitCap = (transcript, maxTurns) =>
  maxTurns !== undefined && transcript.at(-1)?.role === 'tool' && transcript.filter((m) => m.role === 'assistant').length >= maxTurns

// measureDimensions() and measureVolume() in the model code, as fluent.md
// teaches, with the numbers logged back to the model.
const MEASURES_IN_CODE = /\bmeasure[A-Z]\w*\s*\(/
const measuringRun = (call, result) =>
  TRIALS.has(call.name) && MEASURES_IN_CODE.test(call.input?.source ?? '') && parsed(result?.content)?.console?.length > 0

// A write or edit whose build report carries the model's geometry already did what a measure call would.
const measuredSave = (call, result) => {
  if (call.name !== 'write' && call.name !== 'edit') return false
  const report = parsed(result?.content)
  return report?.ok === true && !report.error && report.geometry !== undefined && report.geometry !== null
}

// A measure or check call, a clean write or edit, or a run (legacy eval) that measures in code and logs it.
const verifies = (call, resultOf) =>
  call.name === 'measure' || call.name === 'check' || measuredSave(call, resultOf.get(call.id)) || measuringRun(call, resultOf.get(call.id))

// The transcript-based dimensions: everything except geometry, which needs the final measure.
// `maxTurns` is the run's turn cap, when known.
export function gradeTranscript(fixture, transcript, { maxTurns } = {}) {
  const calls = toolCallsOf(transcript)
  const results = resultsOf(transcript)
  const names = calls.map((c) => c.name)
  const resultOf = new Map(results.map((r) => [r.toolCallId, r]))

  // Measuring after a save verifies as well as measuring before it: a save builds the model too.
  const firstWrite = names.findIndex((n) => SAVES.has(n))
  const verifiedBefore = calls.slice(0, firstWrite === -1 ? calls.length : firstWrite).some((c) => verifies(c, resultOf))
  const verifiedAfter = firstWrite !== -1 && calls.slice(firstWrite).some((c) => verifies(c, resultOf))
  let discipline = 0
  if (names.some((n) => TRIALS.has(n))) {
    discipline = !fixture.verifyBeforeWrite || firstWrite === -1 || verifiedBefore || verifiedAfter ? 2 : 1
  } else if (verifiedAfter) {
    discipline = 2
  }

  // No failures means nothing to recover from: full marks, same as a recovered run.
  // The capped last round had no turn left to recover in.
  const lastRound = hitCap(transcript, maxTurns) ? transcript.slice(transcript.findLastIndex((m) => m.role === 'assistant')) : []
  let recovery = 2
  const failures = results.filter((r) => failed(r.content) && !lastRound.includes(r))
  if (failures.length > 0) {
    const lastFailureAt = transcript.lastIndexOf(failures[failures.length - 1])
    const laterSuccess = results
      .filter((r) => transcript.indexOf(r) > lastFailureAt)
      .some((r) => !failed(r.content))
    recovery = laterSuccess ? 2 : 0
  }

  // Saving often and reading before editing are wanted: a write, edit, read or
  // list counts only when it failed, and a legacy writeModel never does.
  const free = (c) => SAVES.has(c.name) || c.name === 'read' || c.name === 'list'
  const spent = calls.filter((c) => (free(c) ? c.name !== 'writeModel' && failed(resultOf.get(c.id)?.content) : true)).length
  const conservation = spent <= 12 ? 2 : spent <= 24 ? 1 : 0

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
// which stops counting at the first successful build.
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
// that requires a write gets geometry 0 and checkRate 0 without one.
export function gradeFixture(fixture, transcript, finalMeasure, context = {}, { maxTurns } = {}) {
  const { dimensions, firstAttemptFailures: faf } = gradeTranscript(fixture, transcript, { maxTurns })
  const model = gradedModel(fixture, transcript)
  const unsaved = requiresWrite(fixture) && !model

  let rate = 0
  if (!unsaved) {
    const source = model ? Object.values(model.files).filter((f) => typeof f === 'string').join('\n') : ''
    const checksContext = { ...context, source }
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
