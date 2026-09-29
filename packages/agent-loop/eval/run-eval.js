// Usage (from packages/agent-loop):
//   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor [EVAL_API=modeling] npm run eval
//   npm run eval -- --compare eval/results/a.json eval/results/b.json
// Runs the suite live. Never in CI: every run spends real API budget.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMessages, buildSystemPrompt, createProvider, DEFAULT_API, runTurn } from '../index.js'
import { checkApi } from '../src/api.js'
import { evalResultsDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'
import { resolveCredentials } from './credentials.js'
import { endedWithoutReply, gradedModel, gradeFixture, gradeTranscript, geometryError, transcriptMetrics } from './grade.js'
import { conversationTag, createLiveLog, formatLiveHeader, liveLogPath, prefixBlock } from './live-log.js'
import { concurrencyFrom, runSuiteParallel } from './parallel.js'
import { computeSpeed, formatComparison, formatSummary, summarize } from './report.js'
import { killExecutors, sandboxFrom, sandboxProblem, startExecutor } from './sandbox.js'
import { formatRunHeader, formatText, formatToolCall, formatToolResult } from './verbose.js'

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

// Sortable UTC timestamp so two runs on the same day and prompt don't collide:
// <YYYY-MM-DD>T<HHMMSS>Z-<model>-<api>-<sha8>.json
export const resultFileName = (model, api, promptSha256, now = new Date()) => {
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')
  return `${timestamp}-${model}-${api}-${promptSha256.slice(0, 8)}.json`
}

// `only`: null runs every ungrouped fixture (the default CSG suite); a list of
// fixture and/or group names runs their union; ['all'] runs everything. A
// fixture that declares an `api` runs only under that api.
export function selectFixtures(fixtures, only, api = DEFAULT_API) {
  const forApi = fixtures.filter((f) => !f.api || f.api === api)
  if (!only) return forApi.filter((f) => !f.group)
  if (only.includes('all')) return forApi
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
  {
    provider,
    backend,
    api = DEFAULT_API,
    systemPrompt = buildSystemPrompt(api),
    now,
    maxTurns = fixture.maxTurns,
    toolTimeoutMs,
    gradeTimeoutMs,
    onToolCall,
    onToolResult,
    onText,
  },
) {
  await backend.reset(fixture.files)
  const messages = buildMessages({ systemPrompt, transcript: fixture.transcript ?? [], files: fixture.files ?? {}, message: fixture.prompt })
  let transcript = messages
  let error
  const cappedProvider = withTurnCap(provider, maxTurns, now)
  const startedAt = Date.now()
  try {
    const turn = await runTurn({
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
    api,
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

// One fixture x run for eval/parallel.js: the conversation and its provider
// calls run in this process, model code in the executor `startExecutor()`
// returns (eval/sandbox.js), closed when the run ends.
export async function runJob({ fixture, run, runs, maxTurns }, { provider, api, startExecutor: start }, onLog) {
  let pending = ''
  const flush = () => {
    if (pending) onLog(formatText(pending))
    pending = ''
  }
  const executor = start()
  try {
    onLog(formatRunHeader(fixture, run, runs))
    const result = await runConversation(fixture, run, {
      provider,
      backend: executor,
      api,
      maxTurns,
      onToolCall: (name, input) => {
        flush()
        onLog(formatToolCall(name, input))
      },
      onToolResult: (_name, output) => onLog(formatToolResult(output)),
      onText: (text) => {
        pending += text
      },
    })
    flush()
    return result
  } finally {
    executor.close()
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
// `grader` has `gradeProject` (eval/backend.js, or eval/sandbox.js's sandboxed
// one); `graderFor(api)` instead picks one for the file's api. A file written
// before the api setting has none and is graded as fluent.
export async function regradeResults(file, fixturesByName, { grader, graderFor = () => grader }) {
  const fileGrader = graderFor(file.api ?? DEFAULT_API)
  const results = []
  for (const result of file.results) results.push(await regradeRun(result, fixturesByName.get(result.fixture), fileGrader))
  if (!file.results.some((r) => Array.isArray(r.transcript))) return { ...file, results }
  const speed = computeSpeed(results)
  if (typeof file.speed?.wallSeconds === 'number') speed.wallSeconds = file.speed.wallSeconds
  return { ...file, regradedAt: new Date().toISOString(), results, summary: summarize(results), speed }
}

// Rewritten after every run so an interrupted eval keeps every finished run.
// `wallSeconds` is the elapsed suite time; without it, the runs' seconds are summed.
// `maxTurns` is the model's turn cap, null when each fixture kept its own.
export function saveResults(writeFile, filePath, { model, provider, api, runs, maxTurns = null, promptSha256, results, wallSeconds }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  if (typeof wallSeconds === 'number') speed.wallSeconds = wallSeconds
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, api, runs, maxTurns, promptSha256, date: new Date().toISOString(), summary, speed, results },
      null,
      2,
    ),
  )
  return { summary, speed }
}

// A grader whose executor is started again after one is killed (a grade that
// never finished), so one stuck project does not end the regrade.
export const restartingGrader = (start) => {
  let executor = null
  return {
    gradeProject: (model) => {
      if (!executor?.alive()) executor = start()
      return executor.gradeProject(model)
    },
    close: () => executor?.close(),
  }
}

// Fails closed: model code runs only once the crt sandbox is known to start.
const requireSandbox = async (env) => {
  let sandbox
  let problem
  try {
    sandbox = sandboxFrom(env)
    problem = await sandboxProblem(sandbox)
  } catch (error) {
    problem = error.message
  }
  if (problem) {
    console.error(`run-eval: the eval sandbox is not available: ${problem}`)
    process.exit(1)
  }
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

const main = async (argv, env) => {
  const at = argv.indexOf('--compare')
  if (at !== -1) {
    const [a, b] = [readJson(argv[at + 1]), readJson(argv[at + 2])]
    const { error, warning } = compareApis(a, b)
    if (error) {
      console.error(error)
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
      if (!graders.has(api)) graders.set(api, restartingGrader(() => startExecutor({ api, sandbox })))
      return graders.get(api)
    }
    try {
      for (const path of argv.slice(regradeAt + 1)) {
        const regraded = await regradeResults(readJson(path), fixturesByName, { graderFor })
        writeFileSync(path, JSON.stringify(regraded, null, 2))
        console.log(`run-eval: regraded ${path}`)
      }
    } finally {
      for (const grader of graders.values()) grader.close()
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
  const providerConfig = { kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl }
  createProvider(providerConfig)
  const concurrency = concurrencyFrom(env)
  const maxTurns = modelMaxTurns(env, EVAL_MODEL)
  const promptSha256 = promptHash(buildSystemPrompt(api))
  mkdirSync(resultsDir, { recursive: true })
  const filePath = join(resultsDir, resultFileName(EVAL_MODEL, api, promptSha256))
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
      results,
      wallSeconds: (Date.now() - startedAt) / 1000,
    })
  const onRun = (result, finished) => {
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}`
    logLine(result.error ? `${line}  error: ${result.error}` : line, { tag: conversationTag(label, result.fixture, result.run), toStdout: true })
    save(finished)
  }
  const runSandboxedJob = (job, onJobLog) =>
    runJob(job, { provider: createProvider(providerConfig), api, startExecutor: () => startExecutor({ api, sandbox }) }, onJobLog)

  const results = await runSuiteParallel(fixtures, { runs, concurrency, maxTurns, runJob: runSandboxedJob, onLog, onRun })
  const { summary, speed } = save(results)
  logLine(formatSummary(summary, { ...speed, model: EVAL_MODEL, provider: EVAL_PROVIDER }), { toStdout: true })
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
