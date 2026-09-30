import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProvider } from './fake-provider.js'
import { decodeFrames } from './frames.js'
import { loadFixtures, runJob } from './run-eval.js'
import { memoryMiB, sandboxFrom, sandboxProblem, startExecutor } from './sandbox.js'

// Needs crt (on PATH or EVAL_CRT) and its jscad-eval rootfs (scripts/eval-sandbox-setup.sh); skips without them.
const sandbox = (() => {
  try {
    return sandboxFrom(process.env)
  } catch {
    return null
  }
})()
const problem = sandbox ? await sandboxProblem(sandbox) : 'no crt sandbox configured'

const KEY = 'sk-test-provider-key-canary'
const RUN_EVAL = fileURLToPath(new URL('./run-eval.js', import.meta.url))
const TEXT_LOADER = fileURLToPath(new URL('../text-loader.js', import.meta.url))
const cubeHole = (await loadFixtures()).find((f) => f.name === 'cube-hole')
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const CANARY = join(homedir(), `.jscad-eval-sandbox-canary-${randomBytes(6).toString('hex')}`)
const WRITE_TARGETS = [join(REPO, 'packages/agent-loop/eval/.sandbox-probe'), join(REPO, 'node_modules/.sandbox-probe')]
const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'

// Reports only error codes and byte counts, never what it read.
const PROBE = `const out = []
const fs = process.getBuiltinModule('fs')
const attempt = (name, f) => { try { f(); out.push(name + ':OK') } catch (e) { out.push(name + ':' + (e.code ?? e.message)) } }
attempt('canary', () => fs.readFileSync(${JSON.stringify(CANARY)}))
attempt('config', () => fs.statSync(${JSON.stringify(join(homedir(), '.config'))}))
attempt('dotdot', () => fs.statSync(${JSON.stringify(join(REPO, 'packages/agent-loop/node_modules/@jbroll/jscad-fluent/../../../../.config'))}))
${WRITE_TARGETS.map((path, i) => `attempt('write${i}', () => fs.writeFileSync(${JSON.stringify(path)}, 'x'))`).join('\n')}
module.exports = { main: async () => {
  const net = process.getBuiltinModule('net')
  out.push('net:' + await new Promise((resolve) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 })
    socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT') })
    socket.on('connect', () => { socket.destroy(); resolve('OK') })
    socket.on('error', (e) => resolve(e.code))
  }))
  out.push('env:' + Object.keys(process.env).sort().join('|'))
  throw new Error(out.join(' '))
} }`

const probe = async (options) => {
  const executor = startExecutor({ api: 'fluent', sandbox, ...options })
  try {
    return JSON.parse(await executor.requestTool('eval', { source: PROBE })).error.message
  } finally {
    executor.close()
  }
}

// Records the frames the parent writes to each executor's channel.
const recordingSpawn = () => {
  const calls = []
  const spawn = (command, args, options) => {
    const child = nodeSpawn(command, args, options)
    const written = []
    const channel = child.stdio[3]
    const write = channel.write.bind(channel)
    channel.write = (chunk, ...rest) => {
      written.push(Buffer.from(chunk))
      return write(chunk, ...rest)
    }
    calls.push({ command, args, env: options.env, sent: () => decodeFrames(Buffer.concat(written)) })
    return child
  }
  return { spawn, calls }
}

describe.skipIf(problem)('the crt executor', () => {
  beforeAll(() => writeFileSync(CANARY, 'canary\n', { mode: 0o600 }))
  afterAll(() => {
    rmSync(CANARY, { force: true })
    for (const path of WRITE_TARGETS) rmSync(path, { force: true })
  })

  it('blocks the home dir, ~/.config, the symlink climb, repo writes, the network and the parent env with crt alone', async () => {
    const out = await probe({ permission: false })
    for (const name of ['canary', 'config', 'dotdot']) expect(out).toContain(`${name}:ENOENT`)
    expect(out).toContain('write0:EROFS')
    expect(out).toContain('write1:EROFS')
    expect(out).toMatch(/net:(ENETUNREACH|EHOSTUNREACH)/)
    expect(out).toContain('env:HOME|PATH')
    for (const path of WRITE_TARGETS) expect(existsSync(path)).toBe(false)
  }, 60_000)

  it('denies the same reads and writes again under Node’s permission model', async () => {
    const out = await probe()
    for (const name of ['canary', 'config', 'write0', 'write1']) expect(out).toContain(`${name}:ERR_ACCESS_DENIED`)
    // The permission model lets the climb through a granted symlink by; crt's mount tree has nothing there.
    expect(out).toContain('dotdot:ENOENT')
    expect(out).toMatch(/net:(ENETUNREACH|EHOSTUNREACH)/)
    expect(out).toContain('env:HOME|PATH')
  }, 60_000)

  it('evaluates, measures, checks and grades a normal model', async () => {
    const executor = startExecutor({ api: 'fluent', sandbox })
    try {
      await executor.reset({})
      expect(JSON.parse(await executor.requestTool('eval', { source: CUBE })).ok).toBe(true)
      expect(JSON.parse(await executor.requestTool('measure', {})).volume).toBeCloseTo(8000, 0)
      expect(JSON.parse(await executor.requestTool('check', {})).watertight).toBe(true)
      const graded = await executor.gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' })
      expect(graded.measure.volume).toBeCloseTo(8000, 0)
    } finally {
      executor.close()
    }
  }, 60_000)

  it('serves @jscadui/jscad-text with its bundled font inside the binds', async () => {
    const executor = startExecutor({ api: 'fluent', sandbox })
    try {
      await executor.reset({})
      const text = "const jscadText = require('@jscadui/jscad-text')\njscadText.init(require('@jscad/modeling'))\nmodule.exports = { main: () => jscadText.text2d('JOHN', { size: 12, font: 'Liberation Sans' }) }"
      expect(JSON.parse(await executor.requestTool('eval', { source: text })).ok).toBe(true)
    } finally {
      executor.close()
    }
  }, 60_000)

  it('kills the whole container when model code never yields, and grades nothing', async () => {
    const executor = startExecutor({ api: 'fluent', sandbox, graceMs: 200 })
    const stuck = executor.requestTool('eval', { source: 'module.exports = { main: () => { for (;;); } }' })
    expect(await executor.gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' }, { timeoutMs: 500 })).toEqual({ measure: null, solid: null, params: [] })
    // The channel closes only once node inside the container, which holds its end, is gone.
    await expect(stuck).rejects.toThrow(/executor exited: grading ran past 0.7 s/)
    expect(executor.alive()).toBe(false)
  }, 60_000)

  it('ends an executor that outlives its lifetime, with no help from the parent', async () => {
    const executor = startExecutor({ api: 'fluent', sandbox, lifetimeS: 2 })
    const started = Date.now()
    await expect(executor.requestTool('eval', { source: 'module.exports = { main: () => { for (;;); } }' })).rejects.toThrow(/executor exited/)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 60_000)

  it('caps the V8 heap under the memory limit', async () => {
    const executor = startExecutor({ api: 'fluent', sandbox })
    try {
      const source = `module.exports = { main: () => { throw new Error('heap:' + process.getBuiltinModule('v8').getHeapStatistics().heap_size_limit) } }`
      const message = JSON.parse(await executor.requestTool('eval', { source })).error.message
      const limitMiB = Number(/heap:(\d+)/.exec(message)[1]) / 2 ** 20
      expect(limitMiB).toBeLessThan(memoryMiB(sandbox.memory))
    } finally {
      executor.close()
    }
  }, 60_000)

  it('runs a conversation without passing the provider key to crt or the executor', async () => {
    const { spawn, calls } = recordingSpawn()
    const fixture = (await loadFixtures()).find((f) => f.name === 'cube-hole')
    process.env.EVAL_API_KEY = KEY
    let result
    try {
      result = await runJob(
        { fixture, run: 1, runs: 1, maxTurns: fixture.maxTurns },
        { provider: createProvider({ kind: 'fake', model: 'ok', apiKey: KEY }), api: 'fluent', startExecutor: () => startExecutor({ api: 'fluent', sandbox, spawn }) },
        () => {},
      )
    } finally {
      delete process.env.EVAL_API_KEY
    }
    expect(result.error).toBeUndefined()
    expect(result.report.checkRate).toBeGreaterThan(0)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.command).toBe(sandbox.crt)
      expect(Object.keys(call.env).sort()).toEqual(sandbox.crtHome ? ['CRT_HOME', 'PATH'] : ['PATH'])
      expect(JSON.stringify([call.args, call.env, call.sent()])).not.toContain(KEY)
    }
    expect(calls[0].sent().map((m) => m.method ?? m.type)).toEqual(['init', 'reset', 'requestTool', 'requestTool', 'requestTool'])
    expect(calls[1].sent().map((m) => m.method ?? m.type)).toEqual(['init', 'gradeProject'])
  }, 60_000)

  it('lets --regrade exit promptly after a stored model ends its executor, with the file written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'regrade-exit-'))
    const file = join(dir, 'result.json')
    const stored = (source) => ({
      fixture: 'cube-hole',
      run: 1,
      maxTurns: 8,
      report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
      metrics: {},
      transcript: [
        { role: 'user', content: cubeHole.prompt },
        { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'writeModel', input: { source } }] },
        { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    writeFileSync(file, JSON.stringify({ api: 'fluent', results: [stored('module.exports = { main: () => process.exit(3) }'), stored(CUBE)] }))
    try {
      const started = Date.now()
      const code = await new Promise((resolve) => {
        const child = nodeSpawn(process.execPath, ['--import', TEXT_LOADER, RUN_EVAL, '--regrade', file], {
          env: { PATH: process.env.PATH, EVAL_CRT: sandbox.crt, ...(sandbox.crtHome ? { CRT_HOME: sandbox.crtHome } : {}) },
          stdio: 'ignore',
        })
        child.on('close', resolve)
      })
      expect(code).toBe(0)
      expect(Date.now() - started).toBeLessThan(30_000)
      const regraded = JSON.parse(readFileSync(file, 'utf8'))
      expect(regraded.regradedAt).toBeTypeOf('string')
      expect(regraded.results[0].report.checkRate).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

