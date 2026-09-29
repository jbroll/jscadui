// Model code from a live model or a stored transcript runs in an executor
// process that never holds the provider key: `crt run` with no network, no
// home, a private /tmp, a clean environment, a read-only rootfs and read-only
// binds of the code the backend loads, and Node's permission model inside that
// as a second layer. The conversation and its provider calls stay in the
// calling process and reach the executor over IPC (eval/executor-protocol.js).
import { fork, spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../src/mainModule.js'
import { createExecutorClient } from './executor-protocol.js'

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
    return {
      kind,
      crt: resolveCrt(env),
      rootfs: env.EVAL_SANDBOX_ROOTFS || DEFAULT_ROOTFS,
      memory: env.EVAL_SANDBOX_MEMORY || DEFAULT_MEMORY,
      crtHome: env.CRT_HOME || undefined,
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

// Binds sit at their host paths so absolute symlinks in node_modules resolve.
export const crtRunArgs = ({ rootfs, memory }, { dirs, entry, permission = true }) => {
  const binds = bindDirs(dirs)
  const unparsable = binds.find((dir) => dir.includes(':'))
  if (unparsable) throw new Error(`crt cannot bind a path containing ':': ${unparsable}`)
  return [
    'run',
    ...ISOLATION,
    '-e',
    'NODE_CHANNEL_FD',
    '-e',
    'NODE_CHANNEL_SERIALIZATION_MODE',
    '-m',
    memory,
    ...binds.flatMap((dir) => ['-v', `${dir}:${dir}:ro`]),
    '--',
    rootfs,
    'node',
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

const childTransport = (child, killChild) => {
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL)
  })
  let gone = false
  const kill = () => {
    if (gone) return
    try {
      killChild()
    } catch {
      // already gone
    }
  }
  live.add(kill)
  const exitHandlers = []
  const exited = (reason) => {
    gone = true
    live.delete(kill)
    for (const fn of exitHandlers) fn(reason)
  }
  child.on('close', (code, signal) => exited([code === null ? `signal ${signal}` : `code ${code}`, stderr.trim()].filter(Boolean).join(': ')))
  child.on('error', (error) => exited(error.message))
  return {
    send: (message) => {
      try {
        child.send(message)
      } catch {
        // channel closed; the close handler reports the exit
      }
    },
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => exitHandlers.push(fn),
    kill,
  }
}

// `permission: false` drops Node's permission model inside crt, so a test can
// show what crt alone blocks. `graceMs`: eval/executor-protocol.js.
export const startExecutor = ({ api, sandbox, spawn = nodeSpawn, permission = true, graceMs }) => {
  if (sandbox.kind === 'child') {
    const child = fork(EXECUTOR, [], { execArgv: sandboxExecArgv(), env: {}, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    return createExecutorClient(childTransport(child, () => child.kill('SIGKILL')), { api, graceMs })
  }
  if (sandbox.kind !== 'crt' || !sandbox.crt) throw new Error('startExecutor: no crt sandbox')
  // crt's process group holds the whole container (node is pid 1 of its own
  // pid namespace), so killing the group reaches model code stuck in a loop.
  const child = spawn(sandbox.crt, crtRunArgs(sandbox, { dirs: readableDirs(), entry: EXECUTOR, permission }), {
    cwd: PACKAGE,
    env: crtEnv(sandbox),
    detached: true,
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  return createExecutorClient(childTransport(child, () => process.kill(-child.pid, 'SIGKILL')), { api, graceMs })
}

const capture = (spawn, command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })

const nodeTooOld = (version) => {
  const [major, minor] = version.split('.').map(Number)
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])
}

// null when an executor starts in `sandbox`; otherwise what is missing and how to set it up.
export const sandboxProblem = async (sandbox, { spawn = nodeSpawn, readyTimeoutMs = 60_000 } = {}) => {
  if (sandbox.kind !== 'crt') return null
  if (!sandbox.crt) return `no crt binary: install crt on PATH or set EVAL_CRT to its absolute path, then run ${SETUP}`
  const home = sandbox.crtHome ?? CRT_HOME_DEFAULT
  if (!existsSync(join(home, sandbox.rootfs, 'bin'))) return `no crt rootfs "${sandbox.rootfs}" in ${home}: run ${SETUP} (CRT_HOME=${home})`
  const env = crtEnv(sandbox)
  const { code, stdout, stderr } = await capture(spawn, sandbox.crt, ['run', ...ISOLATION, '--', sandbox.rootfs, 'node', '--version'], { env })
  const version = /^v(\d+\.\d+\.\d+)/.exec(stdout.trim())?.[1]
  if (code !== 0 || !version) {
    return `node does not run in rootfs "${sandbox.rootfs}" (exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(-STDERR_TAIL)}` : ''}): install the nodejs package in it (ci/jscad-eval.crt) or recreate it with ${SETUP}`
  }
  if (nodeTooOld(version)) {
    return `Node ${version} in rootfs "${sandbox.rootfs}": the executor needs Node ${MIN_NODE.join('.')} or later (module.registerHooks); recreate the rootfs with ${SETUP}`
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
    problem = await sandboxProblem(sandboxFrom(process.env))
  } catch (error) {
    problem = error.message
  }
  if (problem) {
    console.error(`eval sandbox: ${problem}`)
    process.exit(1)
  }
  console.log('eval sandbox: ready')
}
