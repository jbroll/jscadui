import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { PassThrough } from 'node:stream'
import { decodeFrames } from './frames.js'
import { pathToFileURL } from 'node:url'
import {
  bindDirs,
  concurrencyCap,
  crtEnv,
  crtRunArgs,
  heapMiB,
  memoryBytes,
  memoryMiB,
  readableDirs,
  resolveCrt,
  sandboxFrom,
  sandboxProblem,
  startExecutor,
  TRACKED_CONFIG,
  TRUSTED_PATH,
} from './sandbox.js'

const KEY = 'sk-test-provider-key-canary'

let scratch
beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-crt-')))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const executable = (path) => {
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
  return path
}

// A child process that prints `stdout`, then closes with `code`. `sent` holds
// the frames written to its fd 3 channel.
const fakeChild = ({ stdout = '', stderr = '', code = 0, stays = false } = {}) => {
  const child = new EventEmitter()
  const channel = new PassThrough()
  const written = []
  channel.on('data', (chunk) => written.push(chunk))
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdio = [child.stdin, child.stdout, child.stderr, channel]
  Object.defineProperty(child, 'sent', { get: () => decodeFrames(Buffer.concat(written)) })
  child.kill = () => child.emit('close', null, 'SIGKILL')
  if (!stays) {
    setTimeout(() => {
      child.stdout.end(stdout)
      child.stderr.end(stderr)
      child.emit('close', code, null)
    }, 0)
  }
  return child
}

const recordingSpawn = (options) => {
  const calls = []
  const spawn = (command, args, spawnOptions) => {
    const child = fakeChild(options)
    calls.push({ command, args, options: spawnOptions, child })
    return child
  }
  return { spawn, calls }
}

describe('resolveCrt', () => {
  it('takes EVAL_CRT as its real path', () => {
    const real = executable(join(scratch, 'crt'))
    symlinkSync(real, join(scratch, 'crt-link'))
    expect(resolveCrt({ EVAL_CRT: join(scratch, 'crt-link'), PATH: '' })).toBe(real)
  })

  it('refuses a relative or non-executable EVAL_CRT', () => {
    expect(() => resolveCrt({ EVAL_CRT: 'crt' })).toThrow(/absolute/)
    writeFileSync(join(scratch, 'plain'), '')
    expect(() => resolveCrt({ EVAL_CRT: join(scratch, 'plain') })).toThrow(/not an executable/)
  })

  it('finds crt on PATH, skipping relative entries', () => {
    mkdirSync(join(scratch, 'rel'))
    executable(join(scratch, 'rel', 'crt'))
    mkdirSync(join(scratch, 'abs'))
    const found = executable(join(scratch, 'abs', 'crt'))
    const rel = relative(process.cwd(), join(scratch, 'rel'))
    expect(resolveCrt({ PATH: `${rel}::${join(scratch, 'abs')}` })).toBe(found)
    expect(resolveCrt({ PATH: rel })).toBeNull()
  })
})

describe('sandboxFrom', () => {
  it('defaults to the crt sandbox in the jscad-eval rootfs with a 2G memory limit', () => {
    const crt = executable(join(scratch, 'crt'))
    expect(sandboxFrom({ EVAL_CRT: crt })).toEqual({ kind: 'crt', crt, rootfs: 'jscad-eval', memory: '2G', crtHome: undefined, requireMemoryLimit: false })
    expect(sandboxFrom({ PATH: '' }).crt).toBeNull()
  })

  it('reads the rootfs name, memory limit and CRT_HOME', () => {
    const crt = executable(join(scratch, 'crt'))
    expect(sandboxFrom({ EVAL_CRT: crt, EVAL_SANDBOX_ROOTFS: 'other', EVAL_SANDBOX_MEMORY: '1G', CRT_HOME: scratch, EVAL_REQUIRE_MEMORY_LIMIT: '1' })).toEqual({
      kind: 'crt',
      crt,
      rootfs: 'other',
      memory: '1G',
      crtHome: scratch,
      requireMemoryLimit: true,
    })
  })

  it('refuses a plain child for a live eval, and allows it only when asked for without one', () => {
    for (const EVAL_SANDBOX of ['none', 'child']) {
      expect(() => sandboxFrom({ EVAL_SANDBOX })).toThrow(`EVAL_SANDBOX=${EVAL_SANDBOX}: a live eval or --regrade runs model code only in the crt sandbox`)
    }
    expect(sandboxFrom({ EVAL_SANDBOX: 'child' }, { live: false })).toEqual({ kind: 'child' })
    expect(() => sandboxFrom({ EVAL_SANDBOX: 'docker' }, { live: false })).toThrow(/EVAL_SANDBOX=docker/)
  })
})

describe('bindDirs', () => {
  it('drops missing dirs and dirs inside another bound dir', () => {
    for (const dir of ['packages/agent-loop/node_modules', 'node_modules', 'main/node_modules']) mkdirSync(join(scratch, dir), { recursive: true })
    const dirs = ['packages', 'packages/agent-loop/node_modules', 'node_modules', 'missing', 'main/node_modules'].map((d) => join(scratch, d))
    expect(bindDirs(dirs)).toEqual(['main/node_modules', 'node_modules', 'packages'].map((d) => join(scratch, d)))
  })
})

describe('crtRunArgs', () => {
  const sandbox = { kind: 'crt', crt: '/usr/bin/crt', rootfs: 'jscad-eval', memory: '2G' }

  it('runs node in the rootfs with every isolation flag, read-only binds at their host paths, and the permission model', () => {
    mkdirSync(join(scratch, 'packages'))
    mkdirSync(join(scratch, 'node_modules'))
    const dirs = [join(scratch, 'packages'), join(scratch, 'node_modules')]
    const args = crtRunArgs(sandbox, { dirs, entry: '/repo/eval/executor-child.js' })
    expect(args.slice(0, 10)).toEqual(['run', '--net', 'none', '--no-home', '--tmp', 'private', '--clean-env', '--ro-root', '--keep-fd', '3'])
    expect(args).not.toContain('-e')
    expect(args.join(' ')).toContain('-m 2G')
    for (const dir of dirs) expect(args.join(' ')).toContain(`-v ${dir}:${dir}:ro`)
    const tail = args.slice(args.indexOf('--'))
    expect(tail.slice(0, 10)).toEqual(['--', 'jscad-eval', 'timeout', '--foreground', '-s', 'KILL', '1800', 'node', '--max-old-space-size=1536', '--permission'])
    for (const dir of dirs) expect(tail).toContain(`--allow-fs-read=${dir}`)
    expect(tail.at(-1)).toBe('/repo/eval/executor-child.js')
  })

  it('leaves out the permission model only when asked', () => {
    const args = crtRunArgs(sandbox, { dirs: [], entry: '/e.js', permission: false })
    expect(args.slice(args.indexOf('--'))).toEqual(['--', 'jscad-eval', 'timeout', '--foreground', '-s', 'KILL', '1800', 'node', '--max-old-space-size=1536', '/e.js'])
  })

  it('bounds the executor lifetime it is given', () => {
    const args = crtRunArgs(sandbox, { dirs: [], entry: '/e.js', lifetimeS: 240 })
    expect(args.slice(args.indexOf('timeout'), args.indexOf('node'))).toEqual(['timeout', '--foreground', '-s', 'KILL', '240'])
  })

  it('refuses a bind path crt cannot parse', () => {
    mkdirSync(join(scratch, 'a:b'))
    expect(() => crtRunArgs(sandbox, { dirs: [join(scratch, 'a:b')], entry: '/e.js' })).toThrow(/:/)
  })
})

describe('memory', () => {
  it('reads exactly the sizes crt reads, a bare number as bytes', () => {
    expect(memoryBytes('2G')).toBe(2 * 1024 ** 3)
    expect(memoryBytes('2g')).toBe(2 * 1024 ** 3)
    expect(memoryBytes('1536M')).toBe(1536 * 1024 ** 2)
    expect(memoryBytes('524288k')).toBe(512 * 1024 ** 2)
    expect(memoryBytes('1073741824')).toBe(1024 ** 3)
    for (const bad of ['1.5G', '1T', '2GB', ' 2G', '-1G', '', 'lots']) expect(() => memoryBytes(bad)).toThrow(/EVAL_SANDBOX_MEMORY: crt cannot read/)
  })

  it('keeps the V8 heap at three quarters of the limit, and refuses a limit under 512M', () => {
    expect(memoryMiB('2G')).toBe(2048)
    expect(heapMiB('2G')).toBe(1536)
    expect(heapMiB('512M')).toBe(384)
    expect(() => sandboxFrom({ EVAL_SANDBOX_MEMORY: '256M', PATH: '' })).toThrow(/needs at least 512M/)
    expect(() => sandboxFrom({ EVAL_SANDBOX_MEMORY: '1.5G', PATH: '' })).toThrow(/crt cannot read 1.5G/)
  })

  it('caps concurrency so executors x limit fit in three quarters of the host, across processes', () => {
    const gib = 2 ** 30
    expect(concurrencyCap({ concurrency: 6, memory: '2G', totalBytes: 64 * gib })).toBe(6)
    expect(concurrencyCap({ concurrency: 6, memory: '2G', totalBytes: 16 * gib })).toBe(6)
    expect(concurrencyCap({ concurrency: 6, memory: '2G', totalBytes: 16 * gib, processes: 2 })).toBe(3)
    expect(concurrencyCap({ concurrency: 6, memory: '2G', totalBytes: 2 * gib })).toBe(1)
  })
})

describe('crtEnv', () => {
  it('passes crt only a fixed PATH and CRT_HOME when set', () => {
    expect(crtEnv({ crtHome: '/srv/crt' })).toEqual({ PATH: TRUSTED_PATH, CRT_HOME: '/srv/crt' })
    expect(crtEnv({})).toEqual({ PATH: TRUSTED_PATH })
  })
})

describe('startExecutor', () => {
  it('spawns the absolute crt with no key in its arguments, environment or messages', () => {
    const { spawn, calls } = recordingSpawn({ stays: true })
    process.env.EVAL_API_KEY = KEY
    let executor
    try {
      executor = startExecutor({ api: 'fluent', sandbox: { kind: 'crt', crt: '/opt/crt/crt', rootfs: 'jscad-eval', memory: '2G' }, spawn })
    } finally {
      delete process.env.EVAL_API_KEY
    }
    executor.ready.catch(() => {})
    const [{ command, args, options, child }] = calls
    expect(command).toBe('/opt/crt/crt')
    expect(options.env).toEqual({ PATH: TRUSTED_PATH })
    expect(options.detached).toBe(true)
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'pipe'])
    expect(JSON.stringify([args, options.env, child.sent])).not.toContain(KEY)
    expect(child.sent).toEqual([{ type: 'init', api: 'fluent' }])
  })

  it('kills an executor whose frame is over the limit, from its header', async () => {
    const child = fakeChild({ stays: true })
    let killed = false
    const executor = startExecutor({ api: 'fluent', sandbox: { kind: 'child' }, spawn: () => Object.assign(child, { kill: () => (killed = true) }) })
    const header = Buffer.alloc(4)
    header.writeUInt32BE(2 ** 31)
    child.stdio[3].emit('data', header)
    expect(killed).toBe(true)
    child.emit('close', null, 'SIGKILL')
    await expect(executor.ready).rejects.toThrow(/executor exited: the executor sent a frame of 2147483648 bytes, over the \d+-byte limit/)
  })

  it('reports why the executor exited', async () => {
    const child = fakeChild({ stays: true })
    const executor = startExecutor({ api: 'fluent', sandbox: { kind: 'crt', crt: '/opt/crt/crt', rootfs: 'x', memory: '2G' }, spawn: () => child })
    child.stderr.end("Error: Chroot 'x' not found\n")
    child.emit('close', 1, null)
    await expect(executor.ready).rejects.toThrow("executor exited: code 1: Error: Chroot 'x' not found")
  })
})

describe('sandboxProblem', () => {
  const tracked = readFileSync(TRACKED_CONFIG, 'utf8')
  const storedConfig = (name, text = tracked) => {
    mkdirSync(join(scratch, '.config'), { recursive: true })
    writeFileSync(join(scratch, '.config', name), text)
  }
  const rootfs = (name = 'jscad-eval', overrides = {}) => {
    mkdirSync(join(scratch, name, 'bin'), { recursive: true })
    storedConfig(name)
    return { kind: 'crt', crt: '/opt/crt/crt', rootfs: name, memory: '2G', crtHome: scratch, ...overrides }
  }
  // The cgroup crt puts the probe in, seen from the host, holding `max` as its memory.max.
  const cgroupRoot = (max) => {
    const root = join(scratch, 'cgroup')
    mkdirSync(join(root, 'user-1000', 'crt-7'), { recursive: true })
    if (max !== undefined) writeFileSync(join(root, 'user-1000', 'crt-7', 'memory.max'), `${max}\n`)
    return root
  }
  const probeOutput = (node = '24.18.0') => `${JSON.stringify({ node, cgroup: '0::/user-1000/crt-7\n' })}\n`
  const options = (extra = {}) => ({ placementRoots: [], cgroupRoot: extra.cgroupRoot ?? cgroupRoot(2 * 1024 ** 3), readyTimeoutMs: 20, ...extra })

  it('names a missing crt binary and how to provide one', async () => {
    expect(await sandboxProblem({ kind: 'crt', crt: null, rootfs: 'jscad-eval', memory: '2G' }, options())).toMatch(/no crt binary.*EVAL_CRT/)
  })

  it('refuses a CRT_HOME inside $HOME, /tmp or a bound repo dir', async () => {
    const sandbox = rootfs()
    expect(await sandboxProblem(sandbox, options({ placementRoots: [scratch] }))).toMatch(new RegExp(`CRT_HOME ${scratch} overlaps ${scratch}; crt needs it outside`))
    expect(await sandboxProblem(sandbox, options({ placementRoots: [join(scratch, 'jscad-eval')] }))).toMatch(/overlaps/)
    expect(await sandboxProblem(sandbox, options({ placementRoots: [dirname(scratch)] }))).toMatch(/overlaps/)
  })

  it('names a missing rootfs and the setup script', async () => {
    expect(await sandboxProblem({ kind: 'crt', crt: '/opt/crt/crt', rootfs: 'jscad-eval', memory: '2G', crtHome: scratch }, options())).toMatch(
      new RegExp(`no crt rootfs "jscad-eval" in ${scratch}.*scripts/eval-sandbox-setup.sh`),
    )
  })

  it('refuses a rootfs without a stored config outside it', async () => {
    const sandbox = rootfs()
    rmSync(join(scratch, '.config', 'jscad-eval'))
    expect(await sandboxProblem(sandbox, options())).toMatch(/no stored crt config for "jscad-eval".*crt rm jscad-eval/)
  })

  it('refuses a legacy config inside the rootfs, which an older crt reads, even beside a matching stored one', async () => {
    const sandbox = rootfs()
    writeFileSync(join(scratch, 'jscad-eval', 'config'), tracked)
    expect(await sandboxProblem(sandbox, options())).toMatch(/a legacy crt config .*jscad-eval\/config exists.*crt rm jscad-eval/)
    rmSync(join(scratch, 'jscad-eval', 'config'))
    symlinkSync('/nonexistent', join(scratch, 'jscad-eval', 'config'))
    expect(await sandboxProblem(sandbox, options())).toMatch(/a legacy crt config/)
  })

  it('refuses a stored config that differs from ci/jscad-eval.crt in any way', async () => {
    const sandbox = rootfs()
    for (const text of [`${tracked}mount /home:/home:ro\n`, tracked.replace('net       none', 'net       host'), `${tracked}\n`]) {
      storedConfig('jscad-eval', text)
      expect(await sandboxProblem(sandbox, options())).toMatch(/differs from ci\/jscad-eval.crt.*crt rm jscad-eval/)
    }
  })

  it('finds no mount, env or keep-fd line in the tracked config', () => {
    expect(tracked).not.toMatch(/^\s*(mount|env|keep-fd)\s/m)
  })

  it('names a rootfs Node too old for the executor', async () => {
    const { spawn, calls } = recordingSpawn({ stdout: probeOutput('22.14.0') })
    expect(await sandboxProblem(rootfs(), options({ spawn }))).toMatch(/Node 22.14.0 in rootfs "jscad-eval".*22.15/)
    expect(calls[0].args.slice(-4, -1)).toEqual(['jscad-eval', 'node', '-e'])
    expect(calls[0].args).toContain('--ro-root')
    expect(calls[0].args.join(' ')).toContain('-m 2G')
    expect(calls[0].options.env).toEqual({ PATH: TRUSTED_PATH, CRT_HOME: scratch })
  })

  it('names a rootfs without Node', async () => {
    const { spawn } = recordingSpawn({ stdout: '', code: 127 })
    expect(await sandboxProblem(rootfs(), options({ spawn }))).toMatch(/node does not run in rootfs "jscad-eval".*nodejs/)
  })

  it('gives up on a crt that never answers', async () => {
    const { spawn } = recordingSpawn({ stays: true })
    expect(await sandboxProblem(rootfs(), options({ spawn, probeTimeoutMs: 20 }))).toMatch(/node does not run.*no answer within 0.02 s/)
  })

  it('reads the limit crt set from the probe container’s own cgroup', async () => {
    const required = rootfs('jscad-eval', { requireMemoryLimit: true })
    const cases = [
      [2 * 1024 ** 3, false],
      [1024 ** 3, false],
      ['max', true],
      [undefined, true],
      [3 * 1024 ** 3, true],
    ]
    for (const [max, refused] of cases) {
      const { spawn } = recordingSpawn({ stdout: probeOutput() })
      const problem = await sandboxProblem(required, options({ spawn, cgroupRoot: cgroupRoot(max) }))
      if (refused) expect(problem).toMatch(/cannot enforce the executor's 2G memory limit.*sudo crt setup/)
      else expect(problem ?? '').not.toMatch(/cannot enforce/)
      rmSync(join(scratch, 'cgroup'), { recursive: true, force: true })
    }
  })

  it('refuses when the probe reports no cgroup, whatever crt printed', async () => {
    const { spawn } = recordingSpawn({ stdout: `${JSON.stringify({ node: '24.18.0', cgroup: '' })}\n`, stderr: "Warning: failed to set memory limit to 2G\n" })
    expect(await sandboxProblem(rootfs('jscad-eval', { requireMemoryLimit: true }), options({ spawn }))).toMatch(/cannot enforce/)
  })

  it('otherwise warns about an unenforced limit', async () => {
    const warnings = []
    const { spawn } = recordingSpawn({ stdout: probeOutput() })
    await sandboxProblem(rootfs(), options({ spawn, cgroupRoot: cgroupRoot('max'), onWarning: (text) => warnings.push(text) }))
    expect(warnings).toEqual([expect.stringMatching(/cannot enforce the executor's 2G memory limit.*sudo crt setup/)])
  })
})

describe('readableDirs', () => {
  it('grants the main checkout node_modules a linked worktree resolves through', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-dirs-')))
    try {
      const main = join(root, 'main')
      const worktree = join(root, 'worktree')
      for (const dir of ['node_modules/.bin', '.deps-cache', 'packages/agent-loop/node_modules']) mkdirSync(join(main, dir), { recursive: true })
      mkdirSync(join(worktree, 'node_modules'), { recursive: true })
      mkdirSync(join(worktree, 'packages/agent-loop'), { recursive: true })
      mkdirSync(join(worktree, 'packages/other'))
      symlinkSync(join(main, '.deps-cache'), join(worktree, '.deps-cache'))
      symlinkSync(join(main, 'node_modules/.bin'), join(worktree, 'node_modules/.bin'))
      symlinkSync(join(main, 'packages/agent-loop/node_modules'), join(worktree, 'packages/agent-loop/node_modules'))

      const dirs = readableDirs(pathToFileURL(`${worktree}/`))
      expect(dirs).toContain(join(main, '.deps-cache'))
      expect(dirs).toContain(join(main, 'node_modules'))
      expect(dirs).toContain(join(main, 'packages/agent-loop/node_modules'))
      expect(dirs).not.toContain(join(main, 'packages'))
      expect(dirs).not.toContain(join(main, 'packages/agent-loop'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('grants only its own dirs in a plain checkout', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-dirs-')))
    try {
      for (const dir of ['node_modules', '.deps-cache', 'packages']) mkdirSync(join(root, dir))
      expect(readableDirs(pathToFileURL(`${root}/`)).sort()).toEqual(
        ['node_modules', '.deps-cache', 'packages'].map((d) => join(root, d)).sort(),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
