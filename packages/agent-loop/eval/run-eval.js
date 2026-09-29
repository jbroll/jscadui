// Usage (from packages/agent-loop):
//   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval
//   npm run eval -- --compare eval/results/a.json eval/results/b.json
// Runs the suite live. Never in CI: every run spends real API budget.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMessages, createProvider, runTurn, SYSTEM_PROMPT } from '../index.js'
import { evalResultsDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'
import { resolveCredentials } from './credentials.js'
import { endedWithoutReply, gradedModel, gradeFixture, gradeTranscript, geometryError, transcriptMetrics } from './grade.js'
import { conversationTag, createLiveLog, formatLiveHeader, liveLogPath, prefixBlock } from './live-log.js'
import { concurrencyFrom, runSuiteParallel } from './parallel.js'
import { computeSpeed, formatComparison, formatSummary, summarize } from './report.js'
import { createSandboxedGrader, runInChild } from './sandbox.js'

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

// Sortable UTC timestamp so two runs on the same day and prompt don't collide:
// <YYYY-MM-DD>T<HHMMSS>Z-<model>-<sha8>.json
export const resultFileName = (model, promptSha256, now = new Date()) => {
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')
  return `${timestamp}-${model}-${promptSha256.slice(0, 8)}.json`
}

// `only`: null runs every ungrouped fixture (the default CSG suite); a list of
// fixture and/or group names runs their union; ['all'] runs everything.
export function selectFixtures(fixtures, only) {
  if (!only) return fixtures.filter((f) => !f.group)
  if (only.includes('all')) return fixtures
  const wanted = new Set(only)
  return fixtures.filter((f) => wanted.has(f.name) || (f.group && wanted.has(f.group)))
}

export async function loadFixtures(dir = FIXTURES) {
  const fixtures = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    fixtures.push((await import(new URL(file, dir).href)).fixture)
  }
  return fixtures
}

const isContentEvent = (event) => event.type === 'text' || event.type === 'tool_use'

// Wraps the provider for one run: caps the number of send() calls (rounds),
// tallies usage events, counts calls that sent neither content nor usage,
// notes whether the provider itself threw, and times each call against an
// injected clock so the caller can read rounds/usage/speed once the run ends.
const withTurnCap = (provider, maxTurns, now = () => performance.now()) => {
  let rounds = 0
  let emptyReplies = 0
  let providerFailed = false
  let inputTokens = null
  let outputTokens = null
  let reasoningTokens = null
  let providerSeconds = 0
  const firstTokenSeconds = []
  return {
    async *send(messages, tools) {
      rounds += 1
      if (rounds > maxTurns) {
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
          if (isContentEvent(event) || event.type === 'usage') replied = true
          if (event.type === 'usage') {
            if (typeof event.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + event.inputTokens
            if (typeof event.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + event.outputTokens
            if (typeof event.reasoningTokens === 'number') reasoningTokens = (reasoningTokens ?? 0) + event.reasoningTokens
          }
          if (event.type === 'done') {
            if (!replied) emptyReplies += 1
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
    rounds: () => rounds,
    emptyReplies: () => emptyReplies,
    providerFailed: () => providerFailed,
    usage: () => ({ inputTokens, outputTokens, reasoningTokens }),
    speed: () => ({
      providerSeconds,
      firstTokenSeconds: firstTokenSeconds.length
        ? firstTokenSeconds.reduce((a, b) => a + b, 0) / firstTokenSeconds.length
        : null,
    }),
  }
}

export const EMPTY_REPLY = 'empty provider reply'

// One conversation: a fresh backend state, the fixture's prompt, then grading
// on the saved project's geometry, evaluated again in a fresh state so nothing
// the run evaluated after its last save leaks into the grade. An error lands
// on the result, never thrown; `providerError` marks one the provider caused.
export async function runConversation(
  fixture,
  run,
  { provider, backend, systemPrompt = SYSTEM_PROMPT, now, maxTurns = fixture.maxTurns, toolTimeoutMs, gradeTimeoutMs, onToolCall, onToolResult, onText },
) {
  backend.reset(fixture.files)
  const messages = buildMessages({ systemPrompt, transcript: fixture.transcript ?? [], files: fixture.files ?? {}, message: fixture.prompt })
  let transcript = messages
  let error
  const cappedProvider = withTurnCap(provider, maxTurns, now)
  const startedAt = Date.now()
  try {
    const turn = await runTurn({
      conversation: { messages },
      provider: cappedProvider,
      requestTool: async (name, input) => {
        onToolCall?.(name, input)
        const result = await backend.requestTool(name, input)
        onToolResult?.(name, result)
        return result
      },
      onText: (text) => onText?.(text),
      toolTimeoutMs,
    })
    transcript = turn.messages
  } catch (err) {
    error = err.message
  }
  if (!error && cappedProvider.emptyReplies() > 0) error = EMPTY_REPLY
  const providerError = cappedProvider.providerFailed() || error === EMPTY_REPLY
  const seconds = (Date.now() - startedAt) / 1000
  const { measure, solid, params } = await backend.gradeProject(gradedModel(fixture, transcript), { timeoutMs: gradeTimeoutMs })
  const report = gradeFixture(fixture, transcript, measure, { params, solid })
  const { toolCalls, failedCalls, warnings, docsCalls } = transcriptMetrics(transcript)
  const { inputTokens, outputTokens, reasoningTokens } = cappedProvider.usage()
  const { providerSeconds, firstTokenSeconds } = cappedProvider.speed()
  const outputTokensPerSecond =
    outputTokens != null && providerSeconds > 0 ? outputTokens / providerSeconds : null
  return {
    fixture: fixture.name,
    run,
    maxTurns,
    report,
    turns: transcript.length,
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
      providerSeconds,
      firstTokenSeconds,
      outputTokensPerSecond,
      geometryError: geometryError(fixture.target, measure),
    },
    ...(error ? { error } : {}),
    ...(providerError ? { providerError: true } : {}),
  }
}

// Sequential, in this thread: the unit tests and the keyless baseline. The CLI
// runs conversations in worker threads instead (eval/parallel.js).
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
// re-evaluating the saved project with `grader`, unless the run answered a
// different prompt than the current fixture, whose checks then do not apply.
async function regradeRun(result, fixture, grader) {
  if (!fixture) return { ...result, regradeNote: 'fixture no longer exists; kept stored grading' }
  if (!Array.isArray(result.transcript)) return { ...result, regradeNote: 'no transcript; kept stored grading' }
  const { transcript } = result
  const { regradeNote: _stale, ...rest } = result
  const metrics = { ...result.metrics, ...transcriptMetrics(transcript) }
  const model = gradedModel(fixture, transcript)
  const samePrompt = promptOf(fixture, transcript)
  let report
  let regradeNote = samePrompt ? undefined : 'prompt differs from the current fixture; graded as unsaved'
  if (samePrompt || !model) {
    const { measure, solid, params } = await grader.gradeProject(model)
    report = gradeFixture(fixture, transcript, measure, { params, solid })
    metrics.geometryError = geometryError(fixture.target, measure)
  } else {
    const { dimensions, firstAttemptFailures } = gradeTranscript(fixture, transcript)
    const { geometry } = result.report.dimensions
    report = {
      dimensions: { ...dimensions, geometry },
      total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
      firstAttemptFailures,
      checkRate: result.report.checkRate,
    }
    regradeNote = 'prompt differs from the current fixture; kept stored geometry'
  }
  const empty = !result.error && endedWithoutReply(transcript, result.maxTurns ?? fixture.maxTurns)
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
// `grader` has `gradeProject` (eval/backend.js, or eval/sandbox.js's sandboxed one).
export async function regradeResults(file, fixturesByName, { grader }) {
  const results = []
  for (const result of file.results) results.push(await regradeRun(result, fixturesByName.get(result.fixture), grader))
  if (!file.results.some((r) => Array.isArray(r.transcript))) return { ...file, results }
  const speed = computeSpeed(results)
  if (typeof file.speed?.wallSeconds === 'number') speed.wallSeconds = file.speed.wallSeconds
  return { ...file, regradedAt: new Date().toISOString(), results, summary: summarize(results), speed }
}

// Rewritten after every run so an interrupted eval keeps every finished run.
// `wallSeconds` is the elapsed suite time; without it, the runs' seconds are summed.
// `maxTurns` is the model's turn cap, null when each fixture kept its own.
export function saveResults(writeFile, filePath, { model, provider, runs, maxTurns = null, promptSha256, results, wallSeconds }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  if (typeof wallSeconds === 'number') speed.wallSeconds = wallSeconds
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, runs, maxTurns, promptSha256, date: new Date().toISOString(), summary, speed, results },
      null,
      2,
    ),
  )
  return { summary, speed }
}

const main = async (argv, env) => {
  const at = argv.indexOf('--compare')
  if (at !== -1) {
    console.log(formatComparison(readJson(argv[at + 1]), readJson(argv[at + 2])))
    return
  }
  const regradeAt = argv.indexOf('--regrade')
  if (regradeAt !== -1) {
    const fixturesByName = new Map((await loadFixtures()).map((f) => [f.name, f]))
    const grader = createSandboxedGrader()
    try {
      for (const path of argv.slice(regradeAt + 1)) {
        const regraded = await regradeResults(readJson(path), fixturesByName, { grader })
        writeFileSync(path, JSON.stringify(regraded, null, 2))
        console.log(`run-eval: regraded ${path}`)
      }
    } finally {
      grader.close()
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
  const runs = Number(env.EVAL_RUNS) || 3
  const only = env.EVAL_FIXTURES ? env.EVAL_FIXTURES.split(',') : null
  const fixtures = selectFixtures(await loadFixtures(), only)
  const providerConfig = { kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl }
  createProvider(providerConfig)
  const concurrency = concurrencyFrom(env)
  const maxTurns = modelMaxTurns(env, EVAL_MODEL)
  const promptSha256 = promptHash(SYSTEM_PROMPT)
  mkdirSync(resultsDir, { recursive: true })
  const filePath = join(resultsDir, resultFileName(EVAL_MODEL, promptSha256))
  console.log(
    `run-eval: writing ${filePath}  (${fixtures.length * runs} conversations, ${concurrency} at a time, maxTurns ${maxTurns ?? 'per fixture'})`,
  )

  const verbose = env.EVAL_VERBOSE === '1'
  // Always written to the live log so a second terminal can `tail -F` it;
  // EVAL_VERBOSE only controls whether conversation lines also go to stdout.
  const liveLog = createLiveLog(liveLogPath(env))
  const logLine = (text, { tag = EVAL_MODEL, toStdout = false } = {}) => {
    liveLog.write(prefixBlock(tag, text))
    if (toStdout) console.log(text)
  }
  logLine(formatLiveHeader({ provider: EVAL_PROVIDER, model: EVAL_MODEL, promptSha256, fixtureNames: fixtures.map((f) => f.name), runs, maxTurns, filePath }), { toStdout: verbose })

  const onLog = (job, text) => {
    const block = prefixBlock(conversationTag(EVAL_MODEL, job.fixture.name, job.run), text)
    liveLog.write(block)
    if (verbose) process.stdout.write(block)
  }

  const startedAt = Date.now()
  const save = (results) =>
    saveResults(writeFileSync, filePath, {
      model: EVAL_MODEL,
      provider: EVAL_PROVIDER,
      runs,
      maxTurns,
      promptSha256,
      results,
      wallSeconds: (Date.now() - startedAt) / 1000,
    })
  const onRun = (result, finished) => {
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}`
    logLine(result.error ? `${line}  error: ${result.error}` : line, { tag: conversationTag(EVAL_MODEL, result.fixture, result.run), toStdout: true })
    save(finished)
  }
  const runJob = (job, onJobLog) =>
    runInChild({ fixtureName: job.fixture.name, run: job.run, runs, maxTurns: job.maxTurns, provider: providerConfig }, onJobLog)

  const results = await runSuiteParallel(fixtures, { runs, concurrency, maxTurns, runJob, onLog, onRun })
  const { summary, speed } = save(results)
  logLine(formatSummary(summary, { ...speed, model: EVAL_MODEL, provider: EVAL_PROVIDER }), { toStdout: true })
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
