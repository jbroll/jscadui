// Usage (from packages/agent-loop):
//   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor [EVAL_API=modeling] npm run eval
//   npm run eval -- --compare <data>/results/a.json <data>/results/b.json
// Runs the suite live and spends real API budget, so CI runs it only on request (ci/eval).
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { buildMessages, buildSystemPrompt, createProvider, DEFAULT_API, runTurn } from '../index.js'
import { checkApi } from '../src/api.js'
import { evalResultsDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'
import { resolveCredentials } from './credentials.js'
import { complexGates, complexProbe, complexReport, isComplex, renderRecord, scoreComplex, settleRun, userMessagesOf } from './complex.js'
import { endedWithoutReply, GRADE_TIMEOUT_MS, gradedModel, gradeFixture, gradeTranscript, geometryError, transcriptMetrics } from './grade.js'
import { conversationTag, createLiveLog, formatLiveHeader, liveLogPath, prefixBlock } from './live-log.js'
import { concurrencyFrom, runSuiteParallel } from './parallel.js'
import { computeSpeed, formatComparison, formatSummary, summarize } from './report.js'
import { NO_GRADE } from './executor-protocol.js'
import { CALL_TIMEOUT_MS, createSandboxedBackend, gradeInFreshExecutor, READY_TIMEOUT_MS } from './sandboxed-backend.js'
import { concurrencyCap, killExecutors, sandboxFrom, sandboxProblem, startExecutor } from './sandbox.js'
import { formatRetry, formatRunHeader, formatText, formatToolCall, formatToolResult } from './verbose.js'

const FIXTURES = new URL('./fixtures/', import.meta.url)
const MODELS = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'))

// The model-level turn cap: EVAL_MAX_TURNS, else models.json; null leaves each
// fixture its own maxTurns.
export const modelMaxTurns = (env, model, models = MODELS) => {
  const fromEnv = Number(env.EVAL_MAX_TURNS)
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv
  return models[model]?.maxTurns ?? null
}

export const promptHash = (prompt) => createHash('sha256').update(prompt).digest('hex')

export const evalApi = (env) => checkApi(env.EVAL_API || DEFAULT_API)

export const fileStamp = (now = new Date()) => now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')

// Sortable UTC timestamp so two runs on the same day and prompt don't collide:
// <YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>[-complex]-<sha8>.json
export const resultFileName = (model, api, promptSha256, now = new Date(), suite) =>
  `${fileStamp(now)}-${model}-${api}${suite === 'complex' ? '-complex' : ''}-${promptSha256.slice(0, 8)}.json`

// A fixture whose starting project differs by api declares `apiFiles`
// ({ fluent: files, modeling: files }); under an api it starts from that api's files.
export const fixtureForApi = (fixture, api) => (fixture?.apiFiles ? { ...fixture, files: fixture.apiFiles[api] ?? {} } : fixture)

// Groups the default suite runs beside the ungrouped fixtures.
export const DEFAULT_GROUPS = new Set(['harder'])

// `only`: null runs the default suite, every ungrouped fixture and every
// fixture in DEFAULT_GROUPS; a list of fixture and/or group names runs their
// union; ['all'] runs everything but the complex group, which runs only when
// named. A fixture that declares an `api` runs only under that api.
export function selectFixtures(fixtures, only, api = DEFAULT_API) {
  const forApi = fixtures.filter((f) => !f.api || f.api === api).map((f) => fixtureForApi(f, api))
  if (!only) return forApi.filter((f) => !f.group || DEFAULT_GROUPS.has(f.group))
  if (only.includes('all')) return forApi.filter((f) => f.group !== 'complex')
  const wanted = new Set(only)
  return forApi.filter((f) => wanted.has(f.name) || (f.group && wanted.has(f.group)))
}

const noApi = (label) => `${label} has no api (written before the api setting)`

// Two result files compare only within one API style.
export const compareApis = (a, b) => {
  if (a.api && b.api) return a.api === b.api ? {} : { error: `run-eval: cannot compare a ${a.api} result with a ${b.api} result` }
  if (!a.api && !b.api) return {}
  return { warning: `run-eval: ${a.api ? `a is ${a.api}` : noApi('a')}; ${b.api ? `b is ${b.api}` : noApi('b')}` }
}

// Verdicts compare only between files that used the same describer and judge.
export const compareSuites = (a, b) => {
  const [aComplex, bComplex] = [a, b].map((f) => f.suite === 'complex')
  if (aComplex !== bComplex) return { error: 'run-eval: cannot compare a complex result with a single-shot one' }
  if (!aComplex) return {}
  for (const stage of ['describer', 'judge']) {
    if (a[stage]?.model !== b[stage]?.model || a[stage]?.promptSha256 !== b[stage]?.promptSha256) {
      return { error: `run-eval: the two complex results used a different ${stage} model or prompt; run that stage with --all on one of them first` }
    }
  }
  return {}
}

export async function loadFixtures(dir = FIXTURES) {
  const fixtures = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    fixtures.push((await import(new URL(file, dir).href)).fixture)
  }
  return fixtures
}

// A grade the fixture's checks or geometryError cannot read (model code can
// shape the one it is measured in) grades nothing, as a model failure.
const scoreGrade = (fixture, transcript, graded, maxTurns, providerError) => {
  try {
    const { measure, solid, params, probe } = graded
    return { report: gradeFixture(fixture, transcript, measure, { params, solid, probe }, { maxTurns, providerError }), geometryError: geometryError(fixture.target, measure) }
  } catch {
    const { measure, solid, params } = NO_GRADE()
    return { report: gradeFixture(fixture, transcript, measure, { params, solid }, { maxTurns, providerError }), geometryError: geometryError(fixture.target, measure) }
  }
}

const isContentEvent = (event) => event.type === 'text' || event.type === 'tool_use'

// Caps the rounds in each user turn (`startTurn()` begins the next) and keeps the run's
// rounds, usage, empty replies, stop reasons, provider failure and timing (docs/architecture.md).
const withTurnCap = (provider, maxTurns, now = () => performance.now(), onRetry) => {
  let rounds = 0
  let turnRounds = 0
  let emptyReplies = 0
  const stopReasons = []
  let providerFailed = false
  let inputTokens = null
  let outputTokens = null
  let reasoningTokens = null
  let providerSeconds = 0
  const firstTokenSeconds = []
  let providerRetries = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      turnRounds += 1
      if (turnRounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      const startedAt = now()
      let firstContentAt = null
      let replied = false
      // The caller (runTurn) calls iterator.return() right after 'done' instead of exhausting
      // the generator, without awaiting it, so bookkeeping can't wait for a trailing finally to
      // run; it finalizes on 'done' itself, before that event is yielded.
      try {
        for await (const event of provider.send(messages, tools)) {
          if (firstContentAt === null && isContentEvent(event)) firstContentAt = now()
          if (isContentEvent(event)) replied = true
          if (event.type === 'usage') {
            if (typeof event.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + event.inputTokens
            if (typeof event.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + event.outputTokens
            if (typeof event.reasoningTokens === 'number') reasoningTokens = (reasoningTokens ?? 0) + event.reasoningTokens
          }
          if (event.type === 'retry') {
            providerRetries += 1
            onRetry?.(event)
          }
          if (event.type === 'done') {
            if (!replied) emptyReplies += 1
            stopReasons.push(event.stopReason ?? null)
            const endedAt = now()
            providerSeconds += (endedAt - startedAt) / 1000
            if (firstContentAt !== null) firstTokenSeconds.push((firstContentAt - startedAt) / 1000)
          }
          yield event
        }
      } catch (error) {
        providerFailed = true
        throw error
      }
    },
    startTurn: () => {
      turnRounds = 0
    },
    rounds: () => rounds,
    capped: () => turnRounds > maxTurns,
    emptyReplies: () => emptyReplies,
    stopReasons: () => [...stopReasons],
    providerFailed: () => providerFailed,
    usage: () => ({ inputTokens, outputTokens, reasoningTokens }),
    retries: () => providerRetries,
    speed: () => ({
      providerSeconds,
      firstTokenSeconds: firstTokenSeconds.length
        ? firstTokenSeconds.reduce((a, b) => a + b, 0) / firstTokenSeconds.length
        : null,
    }),
  }
}

export const EMPTY_REPLY = 'empty provider reply'

// The text a turn's replies showed the user, as the app keeps it for later turns.
const replyText = (messages) =>
  messages
    .filter((m) => m.role === 'assistant' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('')

// One run: the prompt and each follow-up, then a grade of the final project in a fresh state.
// Errors land on the result, never thrown (docs/architecture.md, Eval conversations).
export async function runConversation(
  fixture,
  run,
  {
    provider,
    backend,
    api = DEFAULT_API,
    systemPrompt = buildSystemPrompt(api),
    now,
    maxTurns = fixture.maxTurns,
    toolTimeoutMs,
    gradeTimeoutMs,
    signal,
    render,
    onToolCall,
    onToolResult,
    onText,
    onProviderRetry,
  },
) {
  let error
  let infraError = false
  const noteInfra = (err) => {
    if (!err?.infrastructure) throw err
    infraError = true
    error ??= err.message
  }
  const cappedProvider = withTurnCap(provider, maxTurns, now, onProviderRetry)
  const startedAt = Date.now()
  let transcript = []
  let prior = fixture.transcript ?? []
  let files = fixture.files ?? {}
  for (const [turn, message] of userMessagesOf(fixture).entries()) {
    let build = null
    try {
      build = await backend.reset(files, { build: true })
    } catch (err) {
      noteInfra(err)
    }
    const messages = buildMessages({ systemPrompt, transcript: prior, files, build, message })
    let turnMessages = messages
    if (!infraError) {
      cappedProvider.startTurn()
      try {
        const finished = await runTurn({
          conversation: { messages },
          provider: cappedProvider,
          api,
          requestTool: async (name, input) => {
            onToolCall?.(name, input)
            const result = await backend.requestTool(name, input)
            onToolResult?.(name, result)
            return result
          },
          onText: (text) => onText?.(text),
          toolTimeoutMs,
          signal,
        })
        turnMessages = finished.messages
      } catch (err) {
        if (Array.isArray(err?.messages)) turnMessages = err.messages
        // The cap's own closing round sends nothing back, which runTurn reads as an empty reply.
        if (err?.name === 'EmptyReplyError') {
          if (!cappedProvider.capped()) error = EMPTY_REPLY
        } else {
          error = signal?.aborted && signal.reason instanceof Error ? signal.reason.message : err.message
          if (err?.infrastructure) infraError = true
        }
      }
    }
    // A later turn keeps what it added: its project note, its message and the reply.
    transcript = turn === 0 ? turnMessages : [...transcript, ...turnMessages.slice(messages.length - 2)]
    if (error || infraError) break
    const reply = replyText(turnMessages.slice(messages.length))
    prior = [...prior, { role: 'user', content: message }, ...(reply ? [{ role: 'assistant', content: reply }] : [])]
    files = gradedModel(fixture, transcript)?.files ?? files
  }
  if (!error && cappedProvider.emptyReplies() > 0) error = EMPTY_REPLY
  const providerError = cappedProvider.providerFailed() || cappedProvider.emptyReplies() > 0
  const seconds = (Date.now() - startedAt) / 1000
  const complex = isComplex(fixture)
  let graded = NO_GRADE()
  if (!infraError) {
    try {
      const options = complex ? { timeoutMs: gradeTimeoutMs, probe: complexProbe(fixture), mesh: true } : { timeoutMs: gradeTimeoutMs, probe: fixture.probe }
      graded = await backend.gradeProject(gradedModel(fixture, transcript), options)
    } catch (err) {
      noteInfra(err)
    }
  }
  const {
    report,
    fields = {},
    geometryError: geometry,
  } = complex ? await scoreComplex(fixture, run, transcript, graded, { maxTurns, providerError, render }) : scoreGrade(fixture, transcript, graded, maxTurns, providerError)
  const { toolCalls, failedCalls, warnings, docsCalls } = transcriptMetrics(transcript)
  const { inputTokens, outputTokens, reasoningTokens } = cappedProvider.usage()
  const { providerSeconds, firstTokenSeconds } = cappedProvider.speed()
  const outputTokensPerSecond =
    outputTokens != null && providerSeconds > 0 ? outputTokens / providerSeconds : null
  return {
    fixture: fixture.name,
    run,
    api,
    maxTurns,
    report,
    turns: transcript.length,
    stopReasons: cappedProvider.stopReasons(),
    transcript: transcript.filter((m) => m.role !== 'system'),
    metrics: {
      rounds: cappedProvider.rounds(),
      toolCalls,
      failedCalls,
      warnings,
      docsCalls,
      inputTokens,
      outputTokens,
      reasoningTokens,
      seconds,
      providerRetries: cappedProvider.retries(),
      providerSeconds,
      firstTokenSeconds,
      outputTokensPerSecond,
      geometryError: geometry,
    },
    ...fields,
    ...(error ? { error } : {}),
    ...(providerError ? { providerError: true } : {}),
    ...(infraError ? { infraError: true } : {}),
  }
}

export const RUN_TIMEOUT_MS = 20 * 60_000

// One fixture x run for eval/parallel.js: the conversation and its provider
// calls run in this process, model code in executors from `startExecutor()`
// (eval/sandbox.js) behind eval/sandboxed-backend.js. `runTimeoutMs` caps the
// conversation; grading still follows.
export async function runJob(
  { fixture, run, runs, maxTurns },
  { provider, api, startExecutor: start, runTimeoutMs = RUN_TIMEOUT_MS, maxRestarts, callTimeoutMs, runToolTimeoutMs, render },
  onLog,
) {
  let pending = ''
  const flush = () => {
    if (pending) onLog(formatText(pending))
    pending = ''
  }
  const backend = createSandboxedBackend({ start, maxRestarts, callTimeoutMs, runToolTimeoutMs })
  // Past a call's own limit the backend still needs to kill, restart and reseed.
  const toolTimeoutMs = (callTimeoutMs ?? CALL_TIMEOUT_MS) + READY_TIMEOUT_MS + 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`run time limit of ${runTimeoutMs / 1000} s reached`)), runTimeoutMs)
  try {
    onLog(formatRunHeader(fixture, run, runs))
    const result = await runConversation(fixture, run, {
      provider,
      backend,
      api,
      maxTurns,
      toolTimeoutMs,
      signal: controller.signal,
      render,
      onToolCall: (name, input) => {
        flush()
        onLog(formatToolCall(name, input))
      },
      onToolResult: (_name, output) => onLog(formatToolResult(output)),
      onText: (text) => {
        pending += text
      },
      onProviderRetry: (event) => {
        flush()
        onLog(formatRetry(event))
      },
    })
    flush()
    if (backend.exhausted() && !result.error) result.error = `model code ended the evaluator ${backend.crashes()} times`
    return result
  } finally {
    clearTimeout(timer)
    backend.close()
  }
}

// Sequential, with one in-process backend: the unit tests and the keyless
// baseline. The CLI runs each conversation against its own sandboxed executor.
export async function runSuite(fixtures, { provider, backend, runs = 1, onRun, onRunStart, ...options }) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    for (let run = 1; run <= runs; run += 1) {
      onRunStart?.(fixture, run, runs)
      const result = await runConversation(fixture, run, { provider, backend, ...options })
      results.push(result)
      onRun?.(result)
    }
  }
  return results
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const promptOf = (fixture, transcript) => transcript.some((m) => m.role === 'user' && m.content === fixture.prompt)

// Regrades one stored run with no provider calls. Geometry comes from
// rebuilding the saved project with `grader`, unless the run answered a
// different prompt than the current fixture, whose checks then do not apply.
// Before the file tools a run that never wrote was marked `saved: false`.
const renamedSaved = (result) => {
  const { saved, ...report } = result.report ?? {}
  if (saved === undefined) return result
  return { ...result, report: { ...report, ...(saved === false && !result.providerError ? { wrote: false } : {}) } }
}

// A complex run's gates again, and its verdict kept only while its mesh is the one that was judged.
async function regradeComplex(run, fixture, grader, { transcript, maxTurns, providerError, metrics }) {
  const graded = await grader.gradeProject(gradedModel(fixture, transcript), { probe: complexProbe(fixture), mesh: true })
  const gates = complexGates(fixture, graded)
  const report = complexReport(fixture, transcript, gates, { maxTurns, providerError })
  const { description, votes, verdict, graderError, describeError, render, renderError: _error, renderStale: _stale, ...kept } = run
  const base = { ...kept, gates, report, metrics: { ...metrics, geometryError: geometryError(fixture.target, graded.measure) } }
  const cleared = { ...base, description: null, verdict: null }
  if (!gates[0].pass) return settleRun(render ? { ...cleared, regradeNote: 'the project no longer builds' } : cleared)
  if (!graded.mesh || graded.mesh.error) return settleRun({ ...cleared, renderError: graded.mesh?.error ?? 'no mesh came back with the grade' })
  let fresh
  try {
    fresh = renderRecord(graded, render?.views ?? [])
  } catch {
    return settleRun({ ...cleared, renderError: 'the grade could not be read' })
  }
  if (render && fresh.meshSha256 === render.meshSha256) {
    return settleRun({
      ...base,
      render,
      description: description ?? null,
      ...(votes ? { votes } : {}),
      verdict: verdict ?? null,
      ...(graderError ? { graderError } : {}),
      ...(describeError ? { describeError } : {}),
    })
  }
  return settleRun({
    ...cleared,
    render: fresh,
    renderStale: true,
    regradeNote: 'the mesh changed; its renders and verdict are stale',
  })
}

async function regradeRun(stored, fixture, grader) {
  const result = renamedSaved(stored)
  if (!fixture) return { ...result, regradeNote: 'fixture no longer exists; kept stored grading' }
  if (!Array.isArray(result.transcript)) return { ...result, regradeNote: 'no transcript; kept stored grading' }
  const { transcript } = result
  const maxTurns = result.maxTurns ?? fixture.maxTurns
  const providerError = result.providerError === true || result.error === EMPTY_REPLY || (!result.error && endedWithoutReply(transcript, maxTurns))
  const { regradeNote: _stale, ...rest } = result
  const metrics = { ...result.metrics, ...transcriptMetrics(transcript) }
  const model = gradedModel(fixture, transcript)
  const samePrompt = promptOf(fixture, transcript)
  if (isComplex(fixture) && (samePrompt || !model)) {
    const regraded = await regradeComplex(rest, fixture, grader, { transcript, maxTurns, providerError, metrics })
    const empty = !result.error && endedWithoutReply(transcript, maxTurns)
    return {
      ...regraded,
      ...(samePrompt ? {} : { regradeNote: 'prompt differs from the current fixture; graded as unsaved' }),
      ...(empty ? { error: EMPTY_REPLY } : {}),
      ...(empty || result.error === EMPTY_REPLY ? { providerError: true } : {}),
    }
  }
  let report
  let regradeNote = samePrompt ? undefined : 'prompt differs from the current fixture; graded as unsaved'
  if (samePrompt || !model) {
    const scored = scoreGrade(fixture, transcript, await grader.gradeProject(model, { probe: fixture.probe }), maxTurns, providerError)
    report = scored.report
    metrics.geometryError = scored.geometryError
  } else {
    const { dimensions, firstAttemptFailures } = gradeTranscript(fixture, transcript, { maxTurns })
    const { geometry } = result.report.dimensions
    report = {
      dimensions: { ...dimensions, geometry },
      total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
      firstAttemptFailures,
      checkRate: result.report.checkRate,
    }
    regradeNote = 'prompt differs from the current fixture; kept stored geometry'
  }
  const empty = !result.error && endedWithoutReply(transcript, maxTurns)
  return {
    ...rest,
    report,
    metrics,
    ...(empty ? { error: EMPTY_REPLY } : {}),
    ...(empty || result.error === EMPTY_REPLY ? { providerError: true } : {}),
    ...(regradeNote ? { regradeNote } : {}),
  }
}

// Recomputes every grading field in a result file with no provider calls.
// `grader` has `gradeProject` (eval/backend.js, or eval/sandbox.js's sandboxed
// one); `graderFor(api)` instead picks one for the file's api. A file written
// before the api setting has none and is graded as fluent.
export async function regradeResults(file, fixturesByName, { grader, graderFor = () => grader }) {
  const api = file.api ?? DEFAULT_API
  const fileGrader = graderFor(api)
  const results = []
  for (const result of file.results) results.push(await regradeRun(result, fixtureForApi(fixturesByName.get(result.fixture), api), fileGrader))
  if (!file.results.some((r) => Array.isArray(r.transcript))) return { ...file, results }
  const speed = computeSpeed(results)
  if (typeof file.speed?.wallSeconds === 'number') speed.wallSeconds = file.speed.wallSeconds
  return { ...file, regradedAt: new Date().toISOString(), results, summary: summarize(results), speed }
}

// Rewritten after every run so an interrupted eval keeps every finished run.
// `wallSeconds` is the elapsed suite time; without it, the runs' seconds are summed.
// `maxTurns` is the model's turn cap, null when each fixture kept its own.
export function saveResults(writeFile, filePath, { model, provider, api, runs, maxTurns = null, promptSha256, suite, results, wallSeconds }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  if (typeof wallSeconds === 'number') speed.wallSeconds = wallSeconds
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, api, runs, maxTurns, promptSha256, ...(suite ? { suite } : {}), date: new Date().toISOString(), summary, speed, results },
      null,
      2,
    ),
  )
  return { summary, speed }
}

// A hard lifetime for each executor (crt runs it under `timeout -s KILL`), so
// one survives a SIGKILLed run-eval only that long.
export const GRADE_LIFETIME_S = GRADE_TIMEOUT_MS / 1000 + 60
const conversationLifetimeS = (runTimeoutMs) => Math.ceil(runTimeoutMs / 1000) + 60

export const runTimeoutFrom = (env) => {
  const seconds = Number(env.EVAL_RUN_TIMEOUT)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RUN_TIMEOUT_MS
}

// Grades each stored project in its own executor, so one stored model can
// neither end the regrade nor forge a later run's grade.
export const freshExecutorGrader = (start) => ({ gradeProject: (model, options) => gradeInFreshExecutor(start, model, options) })

const LOUD = '!'.repeat(72)

// Fails closed: model code runs only once the crt sandbox is known to start.
export const requireSandbox = async (env) => {
  let sandbox
  let problem
  const warnings = []
  try {
    sandbox = sandboxFrom(env)
    problem = await sandboxProblem(sandbox, { onWarning: (text) => warnings.push(text) })
  } catch (error) {
    problem = error.message
  }
  if (problem) {
    console.error(`run-eval: the eval sandbox is not available: ${problem}`)
    process.exit(1)
  }
  for (const text of warnings) console.error(`${LOUD}\nrun-eval: WARNING: ${text}\n${LOUD}`)
  process.on('exit', killExecutors)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(signal, () => {
      killExecutors()
      process.exit(code)
    })
  }
  return sandbox
}

// Chromium starts before any provider call, so a host without it fails first.
const startRenders = async (filePath) => {
  const { createRunRenderer } = await import('./render.js')
  const renders = createRunRenderer(filePath)
  try {
    await renders.start()
  } catch (error) {
    console.error(`run-eval: chromium did not start for the renders (npx playwright install chromium): ${error.message}`)
    process.exit(1)
  }
  return renders
}

const main = async (argv, env) => {
  const at = argv.indexOf('--compare')
  if (at !== -1) {
    const [a, b] = [readJson(argv[at + 1]), readJson(argv[at + 2])]
    const { error, warning } = compareApis(a, b)
    const suites = compareSuites(a, b)
    if (error || suites.error) {
      console.error(error ?? suites.error)
      process.exit(1)
    }
    if (warning) console.error(warning)
    console.log(formatComparison(a, b))
    return
  }
  const regradeAt = argv.indexOf('--regrade')
  if (regradeAt !== -1) {
    const sandbox = await requireSandbox(env)
    const fixturesByName = new Map((await loadFixtures()).map((f) => [f.name, f]))
    const graders = new Map()
    const graderFor = (api) => {
      if (!graders.has(api)) graders.set(api, freshExecutorGrader(() => startExecutor({ api, sandbox, lifetimeS: GRADE_LIFETIME_S })))
      return graders.get(api)
    }
    for (const path of argv.slice(regradeAt + 1)) {
      const regraded = await regradeResults(readJson(path), fixturesByName, { graderFor })
      writeFileSync(path, JSON.stringify(regraded, null, 2))
      console.log(`run-eval: regraded ${path}`)
    }
    return
  }
  const resultsDir = evalResultsDir(env)
  if (!resultsDir) {
    console.error('run-eval: no results dir: clone jbroll/jscad-chat-evals to ~/src/jscad-chat-evals or set EVAL_RESULTS_DIR')
    process.exit(1)
  }
  const { EVAL_PROVIDER, EVAL_MODEL } = env
  const { apiKey, baseUrl } = resolveCredentials(env)
  if (!EVAL_PROVIDER || !EVAL_MODEL || !apiKey) {
    console.error('run-eval: set EVAL_PROVIDER, EVAL_MODEL and EVAL_API_KEY (EVAL_PROVIDER=meta reads ~/.config/muse/auth.json)')
    process.exit(1)
  }
  const sandbox = await requireSandbox(env)
  const api = evalApi(env)
  const runs = Number(env.EVAL_RUNS) || 3
  const only = env.EVAL_FIXTURES ? env.EVAL_FIXTURES.split(',') : null
  const fixtures = selectFixtures(await loadFixtures(), only, api)
  const complexPass = fixtures.some(isComplex)
  if (complexPass && !fixtures.every(isComplex)) {
    console.error('run-eval: complex fixtures run in a pass of their own; set EVAL_FIXTURES=complex')
    process.exit(1)
  }
  const providerConfig = { kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl }
  createProvider(providerConfig)
  const asked = concurrencyFrom(env)
  const concurrency = concurrencyCap({ concurrency: asked, memory: sandbox.memory, totalBytes: totalmem(), processes: Number(env.EVAL_PROCESSES) || 1 })
  if (concurrency < asked) console.error(`run-eval: EVAL_CONCURRENCY ${asked} lowered to ${concurrency} so executors x ${sandbox.memory} fit in this host's memory`)
  const runTimeoutMs = runTimeoutFrom(env)
  const maxTurns = modelMaxTurns(env, EVAL_MODEL)
  const promptSha256 = promptHash(buildSystemPrompt(api))
  mkdirSync(resultsDir, { recursive: true })
  const suite = complexPass ? 'complex' : undefined
  const filePath = join(resultsDir, resultFileName(EVAL_MODEL, api, promptSha256, new Date(), suite))
  const renders = complexPass ? await startRenders(filePath) : null
  console.log(
    `run-eval: writing ${filePath}  (api ${api}, ${fixtures.length * runs} conversations, ${concurrency} at a time, maxTurns ${maxTurns ?? 'per fixture'})`,
  )

  const verbose = env.EVAL_VERBOSE === '1'
  // Always written to the live log so a second terminal can `tail -F` it;
  // EVAL_VERBOSE only controls whether conversation lines also go to stdout.
  const liveLog = createLiveLog(liveLogPath(env))
  const label = `${EVAL_MODEL}/${api}`
  const logLine = (text, { tag = label, toStdout = false } = {}) => {
    liveLog.write(prefixBlock(tag, text))
    if (toStdout) console.log(text)
  }
  logLine(formatLiveHeader({ provider: EVAL_PROVIDER, model: label, promptSha256, fixtureNames: fixtures.map((f) => f.name), runs, maxTurns, filePath }), { toStdout: verbose })

  const onLog = (job, text) => {
    const block = prefixBlock(conversationTag(label, job.fixture.name, job.run), text)
    liveLog.write(block)
    if (verbose) process.stdout.write(block)
  }

  const startedAt = Date.now()
  const save = (results) =>
    saveResults(writeFileSync, filePath, {
      model: EVAL_MODEL,
      provider: EVAL_PROVIDER,
      api,
      runs,
      maxTurns,
      promptSha256,
      suite,
      results,
      wallSeconds: (Date.now() - startedAt) / 1000,
    })
  const onRun = (result, finished) => {
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}${result.verdictPending ? '  verdict pending' : ''}`
    logLine(result.error ? `${line}  error: ${result.error}` : line, { tag: conversationTag(label, result.fixture, result.run), toStdout: true })
    save(finished)
  }
  const runSandboxedJob = (job, onJobLog) =>
    runJob(
      job,
      { provider: createProvider(providerConfig), api, runTimeoutMs, startExecutor: () => startExecutor({ api, sandbox, lifetimeS: conversationLifetimeS(runTimeoutMs) }), render: renders?.render },
      onJobLog,
    )

  const results = await runSuiteParallel(fixtures, { runs, concurrency, maxTurns, api, runJob: runSandboxedJob, onLog, onRun })
  await renders?.close()
  const { summary, speed } = save(results)
  logLine(formatSummary(summary, { ...speed, model: EVAL_MODEL, provider: EVAL_PROVIDER }), { toStdout: true })
  const infra = results.filter((r) => r.infraError).length
  if (infra) {
    logLine(`run-eval: ${infra} of ${results.length} runs failed in the sandbox (infraError) and are left out of the means`, { toStdout: true })
    process.exitCode = 1
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
