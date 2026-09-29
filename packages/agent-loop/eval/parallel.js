import { Worker } from 'node:worker_threads'
import { gradeFixture } from './grade.js'

export const DEFAULT_CONCURRENCY = 6

const WORKER = new URL('./worker.js', import.meta.url)
// Workers import the prompt's `?raw` files, so they need the CLI's loader hook.
const TEXT_LOADER = new URL('../text-loader.js', import.meta.url).href

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

const crashResult = ({ fixture, run, maxTurns }, error) => ({
  fixture: fixture.name,
  run,
  maxTurns,
  report: gradeFixture(fixture, [], null, { params: [], solid: null }),
  turns: 0,
  transcript: [],
  metrics: {},
  error: `worker crashed: ${error?.message ?? String(error)}`,
})

// Runs every fixture x run job through `runJob` (one worker per conversation in
// the CLI). onRun gets each result as it finishes plus every finished result so
// far, ordered by fixture then run. `maxTurns` is the model's turn cap; null
// leaves each fixture its own.
export async function runSuiteParallel(fixtures, { runs = 1, concurrency = DEFAULT_CONCURRENCY, maxTurns = null, runJob, onLog, onRun }) {
  const jobs = fixtures.flatMap((fixture) =>
    Array.from({ length: runs }, (_, i) => ({ fixture, run: i + 1, runs, maxTurns: maxTurns ?? fixture.maxTurns })),
  )
  const finished = new Array(jobs.length)
  return runPool(jobs, concurrency, async (job, index) => {
    let result
    try {
      result = await runJob(job, (text) => onLog?.(job, text))
    } catch (error) {
      result = crashResult(job, error)
    }
    finished[index] = result
    onRun?.(result, finished.filter(Boolean))
    return result
  })
}

// `data`: { fixtureName, run, runs, maxTurns?, provider: createProvider config, providerModule? }.
// Resolves with the conversation's result; rejects if the worker dies first.
export const runInWorker = (data, onLog) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: data, execArgv: ['--import', TEXT_LOADER] })
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    worker.on('message', (message) => {
      if (message.type === 'log') onLog(message.text)
      if (message.type === 'result') {
        settle(resolve, message.result)
        worker.terminate()
      }
    })
    worker.on('error', (error) => settle(reject, error))
    worker.on('exit', (code) => settle(reject, new Error(`worker exited with code ${code} before a result`)))
  })
