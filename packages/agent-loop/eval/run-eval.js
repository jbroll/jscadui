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
import { createEvalBackend } from './backend.js'
import { resolveCredentials } from './credentials.js'
import { gradeFixture, gradeTranscript, geometryError, transcriptMetrics } from './grade.js'
import { computeSpeed, formatComparison, formatSummary, summarize } from './report.js'
import { formatRunHeader, formatText, formatToolCall, formatToolResult } from './verbose.js'

const FIXTURES = new URL('./fixtures/', import.meta.url)

export const promptHash = (prompt) => createHash('sha256').update(prompt).digest('hex')

export async function loadFixtures(dir = FIXTURES) {
  const fixtures = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    fixtures.push((await import(new URL(file, dir).href)).fixture)
  }
  return fixtures
}

const isContentEvent = (event) => event.type === 'text' || event.type === 'tool_use'

// Wraps the provider for one run: caps the number of send() calls (rounds),
// tallies usage events, and times each call against an injected clock so the
// caller can read rounds/usage/speed once the run ends.
const withTurnCap = (provider, maxTurns, now = () => performance.now()) => {
  let rounds = 0
  let inputTokens = null
  let outputTokens = null
  let providerSeconds = 0
  const firstTokenSeconds = []
  let postFirstTokenSeconds = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      if (rounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      const startedAt = now()
      let firstContentAt = null
      // The caller (runTurn) calls iterator.return() right after 'done' instead of exhausting
      // the generator, without awaiting it, so bookkeeping can't wait for a trailing finally to
      // run; it finalizes on 'done' itself, before that event is yielded.
      for await (const event of provider.send(messages, tools)) {
        if (firstContentAt === null && isContentEvent(event)) firstContentAt = now()
        if (event.type === 'usage') {
          if (typeof event.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + event.inputTokens
          if (typeof event.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + event.outputTokens
        }
        if (event.type === 'done') {
          const endedAt = now()
          providerSeconds += (endedAt - startedAt) / 1000
          if (firstContentAt !== null) {
            firstTokenSeconds.push((firstContentAt - startedAt) / 1000)
            postFirstTokenSeconds += (endedAt - firstContentAt) / 1000
          }
        }
        yield event
      }
    },
    rounds: () => rounds,
    usage: () => ({ inputTokens, outputTokens }),
    speed: () => ({
      providerSeconds,
      firstTokenSeconds: firstTokenSeconds.length
        ? firstTokenSeconds.reduce((a, b) => a + b, 0) / firstTokenSeconds.length
        : null,
      postFirstTokenSeconds,
    }),
  }
}

export async function runSuite(
  fixtures,
  { provider, backend, runs = 1, systemPrompt = SYSTEM_PROMPT, now, onRun, onRunStart, onToolCall, onToolResult, onText },
) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    for (let run = 1; run <= runs; run += 1) {
      onRunStart?.(fixture, run, runs)
      backend.reset()
      const messages = buildMessages({ systemPrompt, transcript: fixture.transcript ?? [], files: fixture.files ?? {}, message: fixture.prompt })
      let transcript = messages
      let error
      const cappedProvider = withTurnCap(provider, fixture.maxTurns, now)
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
        })
        transcript = turn.messages
      } catch (err) {
        error = err.message
      }
      const seconds = (Date.now() - startedAt) / 1000
      const finalMeasure = JSON.parse(await backend.requestTool('measure', {}))
      const measure = finalMeasure.ok ? finalMeasure : null
      const report = gradeFixture(fixture, transcript, measure, { params: backend.params() })
      const { toolCalls, failedCalls, warnings, docsCalls } = transcriptMetrics(transcript)
      const { inputTokens, outputTokens } = cappedProvider.usage()
      const { providerSeconds, firstTokenSeconds, postFirstTokenSeconds } = cappedProvider.speed()
      const outputTokensPerSecond =
        outputTokens != null && postFirstTokenSeconds > 0 ? outputTokens / postFirstTokenSeconds : null
      const result = {
        fixture: fixture.name,
        run,
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
          seconds,
          providerSeconds,
          firstTokenSeconds,
          outputTokensPerSecond,
          geometryError: geometryError(fixture.target, measure),
        },
        ...(error ? { error } : {}),
      }
      results.push(result)
      onRun?.(result)
    }
  }
  return results
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// Recomputes the transcript-based grading fields in a result file with no provider calls.
// Geometry and checkRate need the final measure, which the file doesn't store, so they're kept as-is.
export function regradeResults(file, fixturesByName) {
  const results = file.results.map((result) => {
    const fixture = fixturesByName.get(result.fixture)
    if (!fixture) return result
    const { dimensions, firstAttemptFailures } = gradeTranscript(fixture, result.transcript)
    const { geometry } = result.report.dimensions
    return {
      ...result,
      report: {
        dimensions: { ...dimensions, geometry },
        total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
        firstAttemptFailures,
        checkRate: result.report.checkRate,
      },
      metrics: { ...result.metrics, ...transcriptMetrics(result.transcript) },
    }
  })
  return { ...file, results, summary: summarize(results), speed: computeSpeed(results) }
}

// Rewritten after every run so an interrupted eval keeps every finished run.
export function saveResults(writeFile, filePath, { model, provider, runs, promptSha256, results }) {
  const summary = summarize(results)
  const speed = computeSpeed(results)
  writeFile(
    filePath,
    JSON.stringify(
      { model, provider, runs, promptSha256, date: new Date().toISOString(), summary, speed, results },
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
    for (const path of argv.slice(regradeAt + 1)) {
      const regraded = regradeResults(readJson(path), fixturesByName)
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
  const runs = Number(env.EVAL_RUNS) || 3
  const only = env.EVAL_FIXTURES ? env.EVAL_FIXTURES.split(',') : null
  const fixtures = (await loadFixtures()).filter((f) => !only || only.includes(f.name))
  const provider = createProvider({ kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl })
  const promptSha256 = promptHash(SYSTEM_PROMPT)
  mkdirSync(resultsDir, { recursive: true })
  const filePath = join(resultsDir, `${new Date().toISOString().slice(0, 10)}-${EVAL_MODEL}-${promptSha256.slice(0, 8)}.json`)
  console.log(`run-eval: writing ${filePath}`)

  const verbose = env.EVAL_VERBOSE === '1'
  let pending = ''
  const flush = () => {
    if (pending) console.log(formatText(pending))
    pending = ''
  }

  const collected = []
  const onRun = (result) => {
    flush()
    const line = `${result.fixture} run ${result.run}/${runs}  firstFail ${result.report.firstAttemptFailures}  total ${result.report.total}`
    console.log(result.error ? `${line}  error: ${result.error}` : line)
    collected.push(result)
    saveResults(writeFileSync, filePath, { model: EVAL_MODEL, provider: EVAL_PROVIDER, runs, promptSha256, results: collected })
  }

  const hooks = verbose
    ? {
        onRunStart: (fixture, run, n) => console.log(formatRunHeader(fixture, run, n)),
        onToolCall: (name, input) => {
          flush()
          console.log(formatToolCall(name, input))
        },
        onToolResult: (_name, result) => console.log(formatToolResult(result)),
        onText: (text) => {
          pending += text
        },
      }
    : {}

  await runSuite(fixtures, { provider, backend: createEvalBackend(), runs, onRun, ...hooks })
  const { summary, speed } = saveResults(writeFileSync, filePath, {
    model: EVAL_MODEL,
    provider: EVAL_PROVIDER,
    runs,
    promptSha256,
    results: collected,
  })
  console.log(formatSummary(summary, { ...speed, model: EVAL_MODEL, provider: EVAL_PROVIDER }))
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
