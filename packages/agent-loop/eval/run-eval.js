// Usage (from packages/agent-loop):
//   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval
//   npm run eval -- --compare eval/results/a.json eval/results/b.json
// Runs the suite live. Never in CI: every run spends real API budget.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMessages, createProvider, runTurn, SYSTEM_PROMPT } from '../index.js'
import { createEvalBackend } from './backend.js'
import { resolveCredentials } from './credentials.js'
import { gradeFixture } from './grade.js'
import { formatComparison, formatSummary, summarize } from './report.js'

const FIXTURES = new URL('./fixtures/', import.meta.url)

export const promptHash = (prompt) => createHash('sha256').update(prompt).digest('hex')

export async function loadFixtures(dir = FIXTURES) {
  const fixtures = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    fixtures.push((await import(new URL(file, dir).href)).fixture)
  }
  return fixtures
}

const withTurnCap = (provider, maxTurns) => {
  let rounds = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      if (rounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield* provider.send(messages, tools)
    },
  }
}

export async function runSuite(fixtures, { provider, backend, runs = 1, systemPrompt = SYSTEM_PROMPT }) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    for (let run = 1; run <= runs; run += 1) {
      backend.reset()
      const messages = buildMessages({ systemPrompt, transcript: fixture.transcript ?? [], files: fixture.files ?? {}, message: fixture.prompt })
      let transcript = messages
      let error
      try {
        const turn = await runTurn({
          conversation: { messages },
          provider: withTurnCap(provider, fixture.maxTurns),
          requestTool: (name, input) => backend.requestTool(name, input),
          onText: () => {},
        })
        transcript = turn.messages
      } catch (err) {
        error = err.message
      }
      const finalMeasure = JSON.parse(await backend.requestTool('measure', {}))
      const report = gradeFixture(fixture, transcript, finalMeasure.ok ? finalMeasure : null, { params: backend.params() })
      results.push({ fixture: fixture.name, run, report, turns: transcript.length, ...(error ? { error } : {}) })
    }
  }
  return results
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const main = async (argv, env) => {
  const at = argv.indexOf('--compare')
  if (at !== -1) {
    console.log(formatComparison(readJson(argv[at + 1]), readJson(argv[at + 2])))
    return
  }
  const { EVAL_PROVIDER, EVAL_MODEL } = env
  const { apiKey, baseUrl } = resolveCredentials(env)
  if (!EVAL_PROVIDER || !EVAL_MODEL || !apiKey) {
    console.error('run-eval: set EVAL_PROVIDER, EVAL_MODEL and EVAL_API_KEY (EVAL_PROVIDER=meta reads ~/.config/muse/auth.json)')
    process.exit(1)
  }
  const runs = Number(env.EVAL_RUNS) || 5
  const only = env.EVAL_FIXTURES ? env.EVAL_FIXTURES.split(',') : null
  const fixtures = (await loadFixtures()).filter((f) => !only || only.includes(f.name))
  const provider = createProvider({ kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl })
  const results = await runSuite(fixtures, { provider, backend: createEvalBackend(), runs })
  const summary = summarize(results)
  const promptSha256 = promptHash(SYSTEM_PROMPT)
  console.log(formatSummary(summary))
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const file = new URL(`./results/${new Date().toISOString().slice(0, 10)}-${EVAL_MODEL}-${promptSha256.slice(0, 8)}.json`, import.meta.url)
  writeFileSync(file, JSON.stringify({ model: EVAL_MODEL, provider: EVAL_PROVIDER, runs, promptSha256, date: new Date().toISOString(), summary, results }, null, 2))
  console.log(`run-eval: wrote ${fileURLToPath(file)}`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main(process.argv.slice(2), process.env)
}
