// Usage: npm run describe -w @jscadui/agent-loop -- [--all] <result files>
// Stage B of the complex eval (docs/user-manual.md, Describe and judge); npm runs it in packages/agent-loop, so give absolute paths.
import { execFileSync, spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../src/mainModule.js'
import { settleRun } from './complex.js'
import { summarize } from './report.js'
import { VIEW_LABELS } from './views.js'

export const DESCRIBE_PY = fileURLToPath(new URL('./describer/describe.py', import.meta.url))
export const DEFAULT_DESCRIBER_HOME = '/data/moondream3'
export const DESCRIBE_TIMEOUT_MS = 120_000
export const REQUIRED_FREE_MIB = 11_800
const OLLAMA = 'http://127.0.0.1:11434'

export const DESCRIBE_PROMPT =
  "Describe the object in these renders: what it most likely is, its main parts and how they're arranged, colours, and anything that looks broken or odd. Plain text, under 150 words. Do not guess a purpose you can't see."

export const viewPrompt = (label, { dimensions, bodies }) => `This is the ${label}. Overall size ${dimensions.join('×')} mm, ${bodies} parts.\n\n${DESCRIBE_PROMPT}`

export const DESCRIBE_PROMPT_SHA256 = createHash('sha256').update(viewPrompt('{view}', { dimensions: ['{W}', '{D}', '{H}'], bodies: '{N}' })).digest('hex')

export const describedText = (views) => views.map(({ label, reply }) => `${label}: ${reply.text.trim()}`).join('\n')

// Rendered runs with no description, or with `all` every rendered run; a stale render waits for --rerender.
export const pendingRuns = (file, { all = false } = {}) =>
  file?.suite !== 'complex'
    ? []
    : file.results.filter((r) => r.render?.views?.length > 0 && !r.renderStale && !r.renderError && (all || r.description == null))

// The Node end of describe.py's protocol: JSON lines both ways, one request at a time.
export const startDescriber = ({ command, args = [], env, spawn = nodeSpawn }) => {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let exited = null
  let markReady
  let failReady
  let markDone
  const ready = new Promise((resolveReady, rejectReady) => {
    markReady = resolveReady
    failReady = rejectReady
  })
  ready.catch(() => {})
  const done = new Promise((resolveDone) => {
    markDone = resolveDone
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message?.ready) markReady(message)
    else if (message?.fatal) failReady(new Error(message.fatal))
    else if (message?.done) markDone(message)
    else {
      const settle = waiting.get(message?.id)
      waiting.delete(message?.id)
      settle?.(message)
    }
  })
  const end = (reason) => {
    exited ??= new Error(`the describer exited (${reason})`)
    failReady(exited)
    for (const settle of waiting.values()) settle({ error: exited.message })
    waiting.clear()
    markDone({ done: false, blockedConnections: null, error: exited.message })
  }
  child.on('error', (error) => end(error.message))
  child.on('close', (code, signal) => end(code === null ? `signal ${signal}` : `code ${code}`))
  // A write to a describer that has died (EPIPE) fails here; its 'close' settles the waiting requests.
  child.stdin.on('error', () => {})
  const describe = (request, timeoutMs = DESCRIBE_TIMEOUT_MS) =>
    new Promise((resolveReply) => {
      if (exited) return resolveReply({ id: request.id, error: exited.message })
      const timer = setTimeout(() => {
        waiting.delete(request.id)
        child.kill('SIGKILL')
        resolveReply({ id: request.id, error: `no answer within ${timeoutMs / 1000} s` })
      }, timeoutMs)
      waiting.set(request.id, (reply) => {
        clearTimeout(timer)
        resolveReply(reply)
      })
      child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  return {
    ready,
    describe,
    close: () => {
      child.stdin.end()
      return done
    },
    kill: () => child.kill('SIGKILL'),
  }
}

const describeRun = async (describer, run, dir) => {
  const views = []
  for (const view of run.render.views) {
    const label = VIEW_LABELS[view.name] ?? view.name
    const reply = await describer.describe({ id: `${run.fixture}-${run.run}/${view.name}`, image: resolve(dir, view.path), prompt: viewPrompt(label, run.render.facts) })
    views.push({ name: view.name, label, reply })
  }
  const failed = views.filter(({ reply }) => typeof reply.text !== 'string')
  const { describeError: _describeError, votes: _votes, graderError: _graderError, ...rest } = run
  if (failed.length) {
    return settleRun({ ...rest, description: null, verdict: null, describeError: failed.map(({ name, reply }) => `${name}: ${reply.error ?? 'no text'}`).join('; ') })
  }
  const description = {
    text: describedText(views),
    views: views.map(({ name, reply }) => ({ name, text: reply.text.trim(), ms: reply.ms, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens })),
  }
  return settleRun({ ...rest, description, verdict: null })
}

// Every file is written as its runs finish, and again with the refused-connection count once the process ends.
export async function describeFiles(paths, { all = false, describer, log = () => {} }) {
  const hello = await describer.ready
  const outcome = { described: 0, failed: 0, blockedConnections: null }
  const written = []
  for (const path of paths) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    if (file.suite !== 'complex') {
      log(`describe: ${path} is not a complex result file; skipped`)
      continue
    }
    const runs = pendingRuns(file, { all })
    if (runs.length === 0) continue
    for (const run of runs) {
      const next = await describeRun(describer, run, dirname(path))
      file.results[file.results.indexOf(run)] = next
      outcome[next.describeError ? 'failed' : 'described'] += 1
      log(`describe: ${run.fixture}#${run.run} ${next.describeError ? `failed (${next.describeError})` : 'described'}`)
    }
    file.describer = { model: hello.model, kestrel: hello.kestrel, promptSha256: DESCRIBE_PROMPT_SHA256, blockedConnections: null }
    if (file.summary) file.summary = summarize(file.results)
    writeFileSync(path, JSON.stringify(file, null, 2))
    written.push([path, file])
  }
  const closed = await describer.close()
  outcome.blockedConnections = closed.blockedConnections
  if (!closed.done) outcome.crashed = closed.error
  for (const [path, file] of written) {
    file.describer.blockedConnections = closed.blockedConnections
    writeFileSync(path, JSON.stringify(file, null, 2))
  }
  return outcome
}

// A crash leaves the refused-connection count unknown, so it stops the judge as a refused connection does.
export const describeStop = ({ blockedConnections, crashed }) => {
  if (crashed) return `${crashed}; the outside connections it tried are unknown, so check kestrel before trusting it again`
  if (blockedConnections !== 0) return `the describer tried ${blockedConnections} outside connections, all refused; check kestrel before trusting it again`
  return null
}

const execText = (command, args) => execFileSync(command, args, { encoding: 'utf8' })

const loadedModels = async (fetch) => {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`)
    return res.ok ? ((await res.json()).models ?? []).map((m) => m.name) : []
  } catch {
    return []
  }
}

// Asks Ollama to unload every model it holds, and waits up to `settleMs` for it to.
export const unloadOllama = async ({ fetch = globalThis.fetch, settleMs = 10_000, pollMs = 500 } = {}) => {
  const names = await loadedModels(fetch)
  for (const model of names) {
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => null)
  }
  for (let waited = 0; names.length > 0 && waited < settleMs; waited += pollMs) {
    if ((await loadedModels(fetch)).length === 0) break
    await new Promise((resolveWait) => setTimeout(resolveWait, pollMs))
  }
  return names
}

export const freeGpu = async ({ fetch = globalThis.fetch, exec = execText, settleMs, pollMs } = {}) => {
  const unloaded = await unloadOllama({ fetch, settleMs, pollMs })
  const free = Number(exec('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits']).trim().split('\n')[0])
  if (free >= REQUIRED_FREE_MIB) return { ok: true, free, unloaded }
  const holders = exec('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader']).trim()
  return { ok: false, free, holders, unloaded }
}

export const describerHome = (env) => env.DESCRIBER_HOME || DEFAULT_DESCRIBER_HOME

const PASSED_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'CUDA_VISIBLE_DEVICES']

// Only what Python and CUDA need: the describer never sees a key or the eval's settings.
export const describerEnv = (env, home) => ({
  ...Object.fromEntries(PASSED_ENV.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
  HF_HOME: join(home, 'hf'),
  HF_HUB_OFFLINE: '1',
})

const countPending = (paths, all) => paths.reduce((n, path) => n + pendingRuns(JSON.parse(readFileSync(path, 'utf8')), { all }).length, 0)

// Frees the card, starts describe.py and describes every pending run; the GPU is left alone when there is nothing to do.
export const runDescribe = async (paths, { all = false, env = process.env, log = console.log } = {}) => {
  if (countPending(paths, all) === 0) {
    log('describe: nothing to describe')
    return { described: 0, failed: 0, blockedConnections: 0 }
  }
  const gpu = await freeGpu()
  if (!gpu.ok) {
    throw new Error(`${gpu.free} MiB free on the GPU; the describer needs ${REQUIRED_FREE_MIB}. Holding it:\n${gpu.holders || '(no compute processes listed)'}`)
  }
  const home = describerHome(env)
  const describer = startDescriber({ command: join(home, 'venv', 'bin', 'python'), args: [DESCRIBE_PY], env: describerEnv(env, home) })
  try {
    return await describeFiles(paths, { all, describer, log })
  } finally {
    describer.kill()
  }
}

const USAGE = 'Usage: npm run describe -w @jscadui/agent-loop -- [--all] <result files>'

// Exit 2 is a stop the judge must not run after; 1 only means some views failed (docs/user-manual.md).
const main = async (argv, env) => {
  const paths = argv.filter((arg) => !arg.startsWith('--'))
  if (paths.length === 0) {
    console.error(USAGE)
    process.exit(2)
  }
  try {
    const outcome = await runDescribe(paths, { all: argv.includes('--all'), env })
    console.log(`describe: ${outcome.described} described, ${outcome.failed} failed`)
    const stop = describeStop(outcome)
    if (stop) {
      console.error(`describe: ${stop}`)
      process.exit(2)
    }
    if (outcome.failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`describe: ${error.message}`)
    process.exit(2)
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
