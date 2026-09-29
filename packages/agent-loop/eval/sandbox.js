// Model code from a live model or a stored transcript runs in a child process
// under Node's permission model: it may read only the code the backend loads,
// and may not write files, start processes or threads, or load addons. Node
// 22's permission model has no network control. The child gets an empty
// environment; provider credentials reach it over IPC.
import { fork } from 'node:child_process'
import { readdirSync, realpathSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHILD = fileURLToPath(new URL('./child.js', import.meta.url))
const TEXT_LOADER = fileURLToPath(new URL('../text-loader.js', import.meta.url))
const REPO = new URL('../../../', import.meta.url)

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

export const sandboxExecArgv = (dirs = readableDirs()) => ['--permission', ...dirs.map((dir) => `--allow-fs-read=${dir}`), '--import', TEXT_LOADER]

const spawnChild = () => {
  if (!nodeModule.registerHooks) throw new Error(`the eval sandbox needs Node 22.15 or later (module.registerHooks); this is ${process.version}`)
  return fork(CHILD, [], { execArgv: sandboxExecArgv(), env: {}, serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
}

// `data`: { fixtureName, run, runs, maxTurns?, provider: createProvider config, providerModule? }.
// Resolves with the conversation's result; rejects if the child exits first.
export const runInChild = (data, onLog) =>
  new Promise((resolve, reject) => {
    const child = spawnChild()
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    child.on('message', (message) => {
      if (message.type === 'log') onLog(message.text)
      if (message.type === 'result') settle(resolve, message.result)
    })
    child.on('error', (error) => settle(reject, error))
    child.on('exit', (code) => settle(reject, new Error(`child exited with code ${code} before a result`)))
    child.send({ type: 'conversation', data })
  })

// A long-lived sandboxed child that answers gradeProject requests one at a time.
export const createSandboxedGrader = () => {
  const child = spawnChild()
  const pending = new Map()
  let nextId = 0
  let exited = null
  child.on('message', (message) => {
    if (message.type !== 'graded') return
    pending.get(message.id)?.resolve(message.graded)
    pending.delete(message.id)
  })
  child.on('exit', (code) => {
    exited = new Error(`grader exited with code ${code}`)
    for (const { reject } of pending.values()) reject(exited)
    pending.clear()
  })
  child.send({ type: 'grade-server' })
  return {
    gradeProject: (model) =>
      new Promise((resolve, reject) => {
        if (exited) return reject(exited)
        const id = nextId++
        pending.set(id, { resolve, reject })
        child.send({ type: 'grade', id, model })
      }),
    close: () => child.kill(),
  }
}
