import { gradeFixture } from './grade.js'

export const DEFAULT_CONCURRENCY = 6

export const concurrencyFrom = (env) => {
  const n = Number(env.EVAL_CONCURRENCY)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CONCURRENCY
}

export async function runPool(items, concurrency, run) {
  const results = new Array(items.length)
  let next = 0
  const lane = async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await run(items[index], index)
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane))
  return results
}

const crashResult = ({ fixture, run, maxTurns }, api, error) => ({
  fixture: fixture.name,
  run,
  ...(api ? { api } : {}),
  maxTurns,
  report: gradeFixture(fixture, [], null, { params: [], solid: null }),
  turns: 0,
  transcript: [],
  metrics: {},
  error: `run crashed: ${error?.message ?? String(error)}`,
})

// Runs every fixture x run job through `runJob` (in the CLI, one conversation
// with its own sandboxed executor). onRun gets each result as it finishes plus every finished result so
// far, ordered by fixture then run. `maxTurns` is the model's turn cap; null
// leaves each fixture its own. `api` labels a run that crashed.
export async function runSuiteParallel(fixtures, { runs = 1, concurrency = DEFAULT_CONCURRENCY, maxTurns = null, api, runJob, onLog, onRun }) {
  const jobs = fixtures.flatMap((fixture) =>
    Array.from({ length: runs }, (_, i) => ({ fixture, run: i + 1, runs, maxTurns: maxTurns ?? fixture.maxTurns })),
  )
  const finished = new Array(jobs.length)
  return runPool(jobs, concurrency, async (job, index) => {
    let result
    try {
      result = await runJob(job, (text) => onLog?.(job, text))
    } catch (error) {
      result = crashResult(job, api, error)
    }
    finished[index] = result
    onRun?.(result, finished.filter(Boolean))
    return result
  })
}
