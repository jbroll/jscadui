// Usage: EVAL_PROVIDER=openai EVAL_MODEL=gpt-4o EVAL_API_KEY=sk-... node eval/run-eval.js
// Runs the suite live. Never in CI: every run spends real API budget.
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYSTEM_PROMPT, createProvider, runTurn } from '../index.js'
import { createEvalBackend } from './backend.js'
import { fixture as bracket } from './fixtures/bracket.js'
import { fixture as cubeHole } from './fixtures/cube-hole.js'
import { fixture as gear } from './fixtures/gear.js'
import { gradeFixture } from './grade.js'
import { formatTable } from './report.js'

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

export async function runSuite(fixtures, { provider, backend }) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    backend.reset()
    const conversation = { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: fixture.prompt }] }
    const turn = await runTurn({
      conversation,
      provider: withTurnCap(provider, fixture.maxTurns),
      requestTool: (name, input) => backend.requestTool(name, input),
      onText: () => {},
    })
    const finalMeasure = JSON.parse(await backend.requestTool('measure', {}))
    const geometry = finalMeasure.ok ? finalMeasure : null
    const report = gradeFixture(fixture, turn.messages, geometry)
    results.push({ fixture: fixture.name, report, turns: turn.messages.length })
  }
  return results
}

const main = async () => {
  const { EVAL_PROVIDER, EVAL_MODEL, EVAL_API_KEY, EVAL_BASE_URL } = process.env
  if (!EVAL_PROVIDER || !EVAL_MODEL || !EVAL_API_KEY) {
    console.error('run-eval: set EVAL_PROVIDER, EVAL_MODEL, and EVAL_API_KEY')
    process.exit(1)
  }
  const provider = createProvider({ kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey: EVAL_API_KEY, baseUrl: EVAL_BASE_URL })
  const backend = createEvalBackend()
  const results = await runSuite([cubeHole, gear, bracket], { provider, backend })
  console.log(formatTable(results))
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(new URL(`./results/${stamp}-${EVAL_MODEL}.json`, import.meta.url), JSON.stringify({ model: EVAL_MODEL, results }, null, 2))
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
