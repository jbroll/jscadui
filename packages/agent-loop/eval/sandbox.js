// Model code from a live model or a stored transcript runs in an executor
// process that never holds the provider key: `crt run` with no network, no
// home, a private /tmp, a clean environment, a read-only rootfs and read-only
// binds of the code the backend loads, and Node's permission model inside that
// as a second layer. The conversation and its provider calls stay in the
// calling process and reach the executor through length-capped frames on a
// socket at the executor's fd 3 (eval/frames.js, eval/executor-protocol.js).
import { spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../src/mainModule.js'
import { createExecutorClient, MAX_REPLY_BYTES } from './executor-protocol.js'
import { createFrameReader, encodeFrame } from './frames.js'

const EXECUTOR = fileURLToPath(new URL('./executor-child.js', import.meta.url))
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const REPO = new URL('../../../', import.meta.url)

export const TRUSTED_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export const DEFAULT_ROOTFS = 'jscad-eval'
export const DEFAULT_MEMORY = '2G'
const CRT_HOME_DEFAULT = '/home/crt'
const MIN_NODE = [22, 15]
const SETUP = 'scripts/eval-sandbox-setup.sh'

// A linked worktree (scripts/setup-worktree.sh) reaches node_modules,
// .deps-cache and each package's node_modules through symlinks into the main
// checkout, so the link targets are granted, and so is the main checkout's
// node_modules, which code in those targets resolves its requires through.
export const readableDirs = (repo = REPO) => {
  const dirs = new Set()
  const grantTarget = (link) => {
    try {
      const real = realpathSync(link)
      dirs.add(real)
      if (real !== link) dirs.add(join(dirname(real), 'node_modules'))
    } catch {
      // absent in this checkout
    }
  }
  for (const name of ['packages', 'node_modules', '.deps-cache']) {
    const dir = fileURLToPath(new URL(name, repo))
    dirs.add(dir)
    grantTarget(dir)
  }
  const bin = fileURLToPath(new URL('node_modules/.bin', repo))
  try {
    const real = realpathSync(bin)
    if (real !== bin) dirs.add(dirname(real))
  } catch {
    // no .bin
  }
  const packages = fileURLToPath(new URL('packages', repo))
  let names = []
  try {
    names = readdirSync(packages)
  } catch {
    // no packages dir
  }
  for (const name of names) {
    const own = join(packages, name, 'node_modules')
    try {
      const real = realpathSync(own)
      if (real !== own) dirs.add(real)
    } catch {
      // package without node_modules
    }
  }
  return [...dirs]
}

export const sandboxExecArgv = (dirs = readableDirs()) => ['--permission', ...dirs.map((dir) => `--allow-fs-read=${dir}`)]

const isExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Resolved once, before any model code runs: EVAL_CRT, else the first `crt`
// in an absolute PATH entry. null when there is none.
export const resolveCrt = (env) => {
  if (env.EVAL_CRT) {
    if (!isAbsolute(env.EVAL_CRT)) throw new Error(`EVAL_CRT must be an absolute path, not ${env.EVAL_CRT}`)
    if (!isExecutable(env.EVAL_CRT)) throw new Error(`EVAL_CRT ${env.EVAL_CRT} is not an executable file`)
    return realpathSync(env.EVAL_CRT)
  }
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, 'crt')
    if (isExecutable(candidate)) return realpathSync(candidate)
  }
  return null
}

// `live`: model code from a provider or a stored transcript, which runs only
// under crt. A plain permission-model child is for tests and keyless runs.
export const sandboxFrom = (env, { live = true } = {}) => {
  const kind = env.EVAL_SANDBOX ?? 'crt'
  if (kind === 'crt') {
    const memory = env.EVAL_SANDBOX_MEMORY || DEFAULT_MEMORY
    if (memoryMiB(memory) < MIN_MEMORY_MIB) throw new Error(`EVAL_SANDBOX_MEMORY=${memory}: the executor needs at least ${MIN_MEMORY_MIB}M`)
    return {
      kind,
      crt: resolveCrt(env),
      rootfs: env.EVAL_SANDBOX_ROOTFS || DEFAULT_ROOTFS,
      memory,
      crtHome: env.CRT_HOME || undefined,
      requireMemoryLimit: env.EVAL_REQUIRE_MEMORY_LIMIT === '1',
    }
  }
  if (kind !== 'child' && kind !== 'none') throw new Error(`EVAL_SANDBOX=${kind}: use crt (the default)`)
  if (live) throw new Error(`EVAL_SANDBOX=${kind}: a live eval or --regrade runs model code only in the crt sandbox`)
  return { kind: 'child' }
}

export const bindDirs = (dirs) => {
  const present = [...new Set(dirs)].filter((dir) => existsSync(dir)).sort()
  return present.filter((dir) => !present.some((outer) => outer !== dir && dir.startsWith(`${outer}/`)))
}

const ISOLATION = ['--net', 'none', '--no-home', '--tmp', 'private', '--clean-env', '--ro-root']
const CHANNEL_FD = 3

const UNITS = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }
const MIN_MEMORY_MIB = 512

// crt's memory grammar exactly (parse_memory): digits and an optional K, M or
// G; a bare number is bytes.
export const memoryBytes = (memory) => {
  const match = /^(\d+)([GgMmKk]?)$/.exec(String(memory))
  if (!match) throw new Error(`EVAL_SANDBOX_MEMORY: crt cannot read ${memory} (use digits and K, M or G, e.g. 2G or 1536M)`)
  return Number(match[1]) * UNITS[match[2].toUpperCase()]
}

export const memoryMiB = (memory) => memoryBytes(memory) / 1024 ** 2

// V8's heap stays under the cgroup limit, leaving a quarter for everything else.
export const heapMiB = (memory) => Math.floor(memoryMiB(memory) * 0.75)

export const DEFAULT_LIFETIME_S = 1800

// Executors x memory limit, across `processes` run-eval processes, fit in three
// quarters of the host's memory.
export const concurrencyCap = ({ concurrency, memory, totalBytes, processes = 1 }) => {
  const fits = Math.floor((totalBytes / 2 ** 20) * 0.75 / (memoryMiB(memory) * processes))
  return Math.max(1, Math.min(concurrency, fits))
}

// Binds sit at their host paths so absolute symlinks in node_modules resolve.
// `timeout -s KILL` ends an executor that outlives `lifetimeS`, whatever its
// parent did; --foreground keeps it in crt's process group for the host-side kill.
export const crtRunArgs = ({ rootfs, memory }, { dirs, entry, permission = true, lifetimeS = DEFAULT_LIFETIME_S }) => {
  const binds = bindDirs(dirs)
  const unparsable = binds.find((dir) => dir.includes(':'))
  if (unparsable) throw new Error(`crt cannot bind a path containing ':': ${unparsable}`)
  return [
    'run',
    ...ISOLATION,
    '--keep-fd',
    String(CHANNEL_FD),
    '-m',
    memory,
    ...binds.flatMap((dir) => ['-v', `${dir}:${dir}:ro`]),
    '--',
    rootfs,
    'timeout',
    '--foreground',
    '-s',
    'KILL',
    String(lifetimeS),
    'node',
    `--max-old-space-size=${heapMiB(memory)}`,
    ...(permission ? sandboxExecArgv(binds) : []),
    entry,
  ]
}

export const crtEnv = ({ crtHome }) => ({ PATH: TRUSTED_PATH, ...(crtHome ? { CRT_HOME: crtHome } : {}) })

const live = new Set()

// Kills every executor still running; run-eval calls it on exit and on SIGINT/SIGTERM.
export const killExecutors = () => {
  for (const kill of live) kill()
}

const STDERR_TAIL = 2000

// Frames from the executor are refused past MAX_REPLY_BYTES from their header,
// and the executor is killed: model code can write to the channel too.
const childTransport = (child, killChild) => {
  const channel = child.stdio[CHANNEL_FD]
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL)
  })
  let gone = false
  let violation = null
  const kill = () => {
    if (gone) return
    try {
      killChild()
    } catch {
      // already gone
    }
  }
  live.add(kill)
  const messageHandlers = []
  const exitHandlers = []
  channel.on(
    'data',
    createFrameReader({
      maxBytes: MAX_REPLY_BYTES,
      onFrame: (message) => {
        for (const fn of messageHandlers) fn(message)
      },
      onViolation: (reason) => {
        violation = `the executor sent ${reason}`
        kill()
      },
    }),
  )
  channel.on('error', () => {})
  const exited = (reason) => {
    if (gone) return
    gone = true
    live.delete(kill)
    channel.destroy()
    for (const fn of exitHandlers) fn(violation ?? reason)
  }
  child.on('close', (code, signal) => exited([code === null ? `signal ${signal}` : `code ${code}`, stderr.trim()].filter(Boolean).join(': ')))
  child.on('error', (error) => exited(error.message))
  return {
    send: (message) => {
      if (!gone) channel.write(encodeFrame(message))
    },
    onMessage: (fn) => messageHandlers.push(fn),
    onExit: (fn) => exitHandlers.push(fn),
    kill,
  }
}

export const liveExecutors = () => live.size

const STDIO = ['ignore', 'ignore', 'pipe', 'pipe']

// `permission: false` drops Node's permission model inside crt, so a test can
// show what crt alone blocks. `graceMs`: eval/executor-protocol.js.
export const startExecutor = ({ api, sandbox, spawn = nodeSpawn, permission = true, graceMs, lifetimeS }) => {
  if (sandbox.kind === 'child') {
    const child = spawn(process.execPath, [...sandboxExecArgv(), EXECUTOR], { env: {}, stdio: STDIO })
    return createExecutorClient(childTransport(child, () => child.kill('SIGKILL')), { api, graceMs })
  }
  if (sandbox.kind !== 'crt' || !sandbox.crt) throw new Error('startExecutor: no crt sandbox')
  // crt's process group holds the whole container (timeout is pid 1 of its
  // own pid namespace), so killing the group reaches model code stuck in a loop.
  const child = spawn(sandbox.crt, crtRunArgs(sandbox, { dirs: readableDirs(), entry: EXECUTOR, permission, lifetimeS }), {
    cwd: PACKAGE,
    env: crtEnv(sandbox),
    detached: true,
    stdio: STDIO,
  })
  return createExecutorClient(childTransport(child, () => process.kill(-child.pid, 'SIGKILL')), { api, graceMs })
}

// Runs `script` in the rootfs with node and no permission model, under the
// memory limit. It prints one JSON line and waits for stdin to close, so the
// container's cgroup still exists while `inspect(line)` runs.
const probe = (spawn, sandbox, script, inspect, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(sandbox.crt, ['run', ...ISOLATION, '-m', sandbox.memory, '--', sandbox.rootfs, 'node', '-e', script], {
      env: crtEnv(sandbox),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let inspected
    const timer = setTimeout(() => {
      stderr += `no answer within ${timeoutMs / 1000} s`
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill?.('SIGKILL')
      }
    }, timeoutMs)
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (inspected !== undefined || !stdout.includes('\n')) return
      try {
        inspected = inspect(JSON.parse(stdout.slice(0, stdout.indexOf('\n'))))
      } catch {
        inspected = null
      }
      child.stdin.end()
    })
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const done = (code) => {
      clearTimeout(timer)
      resolve({ code, stderr, inspected: inspected ?? null })
    }
    child.on('error', (error) => {
      stderr += error.message
      done(-1)
    })
    child.on('close', done)
  })

const PROBE = `let cgroup = ''
try { cgroup = require('fs').readFileSync('/proc/self/cgroup', 'utf8') } catch {}
process.stdout.write(JSON.stringify({ node: process.versions.node, cgroup }) + '\\n')
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))`

// The limit crt set, read from the host side of the probe's own cgroup.
const limitInForce = (cgroupRoot, cgroup, bytes) => {
  const path = /^0::(\/.*)$/m.exec(cgroup ?? '')?.[1]
  if (!path) return false
  try {
    const max = readFileSync(join(cgroupRoot, path, 'memory.max'), 'utf8').trim()
    return /^\d+$/.test(max) && Number(max) > 0 && Number(max) <= bytes
  } catch {
    return false
  }
}

export const TRACKED_CONFIG = fileURLToPath(new URL('ci/jscad-eval.crt', REPO))

const nodeTooOld = (version) => {
  const [major, minor] = version.split('.').map(Number)
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])
}

const within = (path, root) => path === root || path.startsWith(`${root}/`)

const realOr = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// crt (5a8a7cc) reads a rootfs's config only from $CRT_HOME/.config/<name>,
// moving a legacy $CRT_HOME/<name>/config there when that is absent; an older
// crt reads the legacy file. Either could hand the executor more of the host
// through its mount and env lines, so the stored config must be the tracked
// file and no legacy file may exist.
const configProblem = (home, rootfs) => {
  const legacy = join(home, rootfs, 'config')
  let legacyExists = true
  try {
    lstatSync(legacy)
  } catch {
    legacyExists = false
  }
  if (legacyExists) return `a legacy crt config ${legacy} exists inside the rootfs, which an older crt reads: crt rm ${rootfs}, then run ${SETUP}`
  const stored = join(home, '.config', rootfs)
  let text
  try {
    text = readFileSync(stored, 'utf8')
  } catch {
    return `no stored crt config for "${rootfs}" at ${stored} (a crt that keeps configs outside the rootfs creates it): crt rm ${rootfs}, then run ${SETUP}`
  }
  const tracked = readFileSync(TRACKED_CONFIG, 'utf8')
  if (text !== tracked) {
    return `the stored crt config ${stored} differs from ci/jscad-eval.crt; the eval runs only under the tracked config: crt rm ${rootfs}, then run ${SETUP}`
  }
  const widening = /^\s*(mount|env|keep-fd)\s/m.exec(tracked)
  if (widening) return `ci/jscad-eval.crt has a ${widening[1]} line; the eval's config must add nothing to the run`
  return null
}

// crt refuses a CRT_HOME inside $HOME, /tmp or a bind source; say so up front.
const placementProblem = (home, roots) => {
  const real = realOr(home)
  const clash = roots.map(realOr).find((root) => within(real, root) || within(root, real))
  return clash ? `CRT_HOME ${home} overlaps ${clash}; crt needs it outside $HOME, /tmp and the repo dirs the eval binds (e.g. /home/crt or /var/lib/crt)` : null
}

const notEnforced = (memory) =>
  `crt cannot enforce the executor's ${memory} memory limit on this host, so model code can take all of its memory; run 'sudo crt setup' once to delegate a cgroup`

// null when an executor starts in `sandbox`; otherwise what is missing and how
// to set it up. An unenforced memory limit is a problem when the sandbox
// requires one (ci/eval), else reported through `onWarning`.
export const sandboxProblem = async (
  sandbox,
  {
    spawn = nodeSpawn,
    readyTimeoutMs = 60_000,
    probeTimeoutMs = 60_000,
    onWarning = () => {},
    cgroupRoot = '/sys/fs/cgroup',
    placementRoots = [homedir(), '/tmp', ...readableDirs()],
  } = {},
) => {
  if (sandbox.kind !== 'crt') return null
  if (!sandbox.crt) return `no crt binary: install crt on PATH or set EVAL_CRT to its absolute path, then run ${SETUP}`
  const home = sandbox.crtHome ?? CRT_HOME_DEFAULT
  const placement = placementProblem(home, placementRoots)
  if (placement) return placement
  if (!existsSync(join(home, sandbox.rootfs, 'bin'))) return `no crt rootfs "${sandbox.rootfs}" in ${home}: run ${SETUP} (CRT_HOME=${home})`
  const config = configProblem(home, sandbox.rootfs)
  if (config) return config
  const bytes = memoryBytes(sandbox.memory)
  const { code, stderr, inspected } = await probe(
    spawn,
    sandbox,
    PROBE,
    ({ node, cgroup }) => ({ node: String(node), limited: limitInForce(cgroupRoot, cgroup, bytes) }),
    probeTimeoutMs,
  )
  const version = /^\d+\.\d+\.\d+$/.exec(inspected?.node ?? '')?.[0]
  if (code !== 0 || !version) {
    return `node does not run in rootfs "${sandbox.rootfs}" (exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(-STDERR_TAIL)}` : ''}): install the nodejs package in it (ci/jscad-eval.crt) or recreate it with ${SETUP}`
  }
  if (nodeTooOld(version)) {
    return `Node ${version} in rootfs "${sandbox.rootfs}": the executor needs Node ${MIN_NODE.join('.')} or later (module.registerHooks); recreate the rootfs with ${SETUP}`
  }
  if (!inspected.limited) {
    if (sandbox.requireMemoryLimit) return notEnforced(sandbox.memory)
    onWarning(notEnforced(sandbox.memory))
  }
  const executor = startExecutor({ api: undefined, sandbox, spawn })
  let timer
  try {
    await Promise.race([
      executor.ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no ready message within ${readyTimeoutMs / 1000}s`)), readyTimeoutMs)
      }),
    ])
    return null
  } catch (error) {
    return `the executor did not start in rootfs "${sandbox.rootfs}": ${error.message}`
  } finally {
    clearTimeout(timer)
    executor.close()
  }
}

if (isMainModule(process.argv[1], import.meta.url) && process.argv[2] === '--check') {
  let problem
  try {
    problem = await sandboxProblem(sandboxFrom(process.env), { onWarning: (text) => console.error(`eval sandbox: WARNING: ${text}`) })
  } catch (error) {
    problem = error.message
  }
  if (problem) {
    console.error(`eval sandbox: ${problem}`)
    process.exit(1)
  }
  console.log('eval sandbox: ready')
}
