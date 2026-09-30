import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESCRIBE_PROMPT_SHA256, describeFiles, describerEnv, describeStop, freeGpu, pendingRuns, REQUIRED_FREE_MIB, startDescriber, viewPrompt } from './describe.js'
import { VIEWS } from './views.js'

const FAKE = fileURLToPath(new URL('./fake-describer.js', import.meta.url))
const fake = (env = {}) => startDescriber({ command: process.execPath, args: [FAKE], env: { PATH: process.env.PATH, ...env } })

const rendered = (overrides = {}) => ({
  fixture: 'caboose',
  run: 1,
  userMessages: ['we need a model of a toy caboose'],
  gates: [{ name: 'builds', pass: true }],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.5 },
  render: {
    meshSha256: 'a'.repeat(64),
    facts: { dimensions: [111, 41, 67], bodies: 62 },
    views: VIEWS.map((v) => ({ name: v.name, path: `r.renders/caboose-1/${v.name}.png`, sha256: 'b'.repeat(64) })),
  },
  description: null,
  verdict: null,
  verdictPending: true,
  ...overrides,
})

const resultFile = (runs, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'describe-test-'))
  mkdirSync(join(dir, 'r.renders', 'caboose-1'), { recursive: true })
  for (const view of VIEWS) writeFileSync(join(dir, 'r.renders', 'caboose-1', `${view.name}.png`), 'png')
  const path = join(dir, 'r.json')
  writeFileSync(path, JSON.stringify({ suite: 'complex', summary: [], results: runs, ...extra }))
  return { dir, path }
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

describe('the describer prompt', () => {
  it('names the view, the size and the part count, then asks for a plain description', () => {
    expect(viewPrompt('side view', { dimensions: [111, 41, 67], bodies: 62 })).toBe(
      "This is the side view. Overall size 111×41×67 mm, 62 parts.\n\nDescribe the object in these renders: what it most likely is, its main parts and how they're arranged, colours, and anything that looks broken or odd. Plain text, under 150 words. Do not guess a purpose you can't see.",
    )
    expect(DESCRIBE_PROMPT_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pendingRuns', () => {
  it('picks rendered runs with no description, or every rendered run with all', () => {
    const file = { suite: 'complex', results: [rendered(), rendered({ description: { text: 'x' } }), rendered({ renderStale: true }), rendered({ render: undefined, renderError: 'no mesh' })] }
    expect(pendingRuns(file)).toEqual([file.results[0]])
    expect(pendingRuns(file, { all: true })).toEqual([file.results[0], file.results[1]])
    expect(pendingRuns({ results: file.results })).toEqual([])
  })
})

describe('describeFiles', () => {
  it('describes each view and writes the description, joined one line per view', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake() })
    expect(outcome).toEqual({ described: 1, failed: 0, blockedConnections: 0 })
    const file = read(path)
    const [run] = file.results
    expect(run.description.text).toBe(VIEWS.map((v) => `${v.label}: described This is the ${v.label}`).join('\n'))
    expect(run.description.views).toEqual(VIEWS.map((v) => ({ name: v.name, text: `described This is the ${v.label}`, ms: 1, inputTokens: 10, outputTokens: 5 })))
    expect(run.verdictPending).toBe(true)
    expect(file.describer).toEqual({ model: 'fake', kestrel: '0.9.1', promptSha256: DESCRIBE_PROMPT_SHA256, blockedConnections: 0 })
  })

  it('leaves a run with a failed view undescribed and says which view', async () => {
    const { dir, path } = resultFile([rendered()])
    rmSync(join(dir, 'r.renders', 'caboose-1', 'side.png'))
    const outcome = await describeFiles([path], { describer: fake() })
    expect(outcome.failed).toBe(1)
    const [run] = read(path).results
    expect(run.description).toBeNull()
    expect(run.describeError).toMatch(/^side: no image at /)
  })

  it('redescribes a judged run with all, clearing its verdict', async () => {
    const { path } = resultFile([rendered({ description: { text: 'old', views: [] }, votes: [{ success: true }], verdict: { success: true, votes: [3, 0] }, verdictPending: undefined })])
    await describeFiles([path], { describer: fake() })
    expect(read(path).results[0].description.text).toBe('old')
    await describeFiles([path], { all: true, describer: fake() })
    const [run] = read(path).results
    expect(run.description.text).not.toBe('old')
    expect(run.verdict).toBeNull()
    expect(run).not.toHaveProperty('votes')
    expect(run.verdictPending).toBe(true)
  })

  it('records the connections the describer refused', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake({ FAKE_DESCRIBER_BLOCKED: '2' }) })
    expect(outcome.blockedConnections).toBe(2)
    expect(read(path).describer.blockedConnections).toBe(2)
  })

  it('fails with the describer own message when it cannot start', async () => {
    const { path } = resultFile([rendered()])
    await expect(describeFiles([path], { describer: fake({ FAKE_DESCRIBER_FATAL: 'describe.py patches kestrel 0.9.1 and found 0.9.2' }) })).rejects.toThrow('found 0.9.2')
  })

  it('reports a describer that dies as a crash, not as refused connections', async () => {
    const { path } = resultFile([rendered()])
    const outcome = await describeFiles([path], { describer: fake({ FAKE_DESCRIBER_CRASH: '1' }) })
    expect(outcome).toMatchObject({ described: 0, failed: 1, blockedConnections: null, crashed: 'the describer exited (code 3)' })
    const file = read(path)
    expect(file.results[0].describeError).toMatch(/^iso-front: the describer exited \(code 3\)/)
    expect(file.describer.blockedConnections).toBeNull()
  })

  it('skips a file that is not a complex pass', async () => {
    const { path } = resultFile([rendered()], { suite: undefined })
    const log = []
    await describeFiles([path], { describer: fake(), log: (line) => log.push(line) })
    expect(read(path).results[0].description).toBeNull()
    expect(log[0]).toMatch(/not a complex result file/)
  })
})

describe('describeStop', () => {
  it('stops the judge after a crash or a refused connection, not after a failed view', () => {
    expect(describeStop({ described: 1, failed: 1, blockedConnections: 0 })).toBeNull()
    expect(describeStop({ described: 1, failed: 0, blockedConnections: 2 })).toMatch(/tried 2 outside connections, all refused/)
    expect(describeStop({ described: 0, failed: 1, blockedConnections: null, crashed: 'the describer exited (code 3)' })).toMatch(/exited \(code 3\).*unknown/)
  })
})

describe('freeGpu', () => {
  const ollama = (loaded) => {
    const calls = []
    const fetch = async (url, init) => {
      calls.push([url, init?.body ?? null])
      if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models: loaded.map((name) => ({ name })) }) }
      loaded.splice(0)
      return { ok: true, json: async () => ({}) }
    }
    return { calls, fetch }
  }
  const smi = (free) => (_command, args) => (args[0].includes('memory.free') ? `${free}\n` : '1234, chatterbox, 3496 MiB\n')

  it('unloads Ollama models, then passes with enough free memory', async () => {
    const { calls, fetch } = ollama(['qwen3.5:9b'])
    const gpu = await freeGpu({ fetch, exec: smi(REQUIRED_FREE_MIB + 200), pollMs: 1 })
    expect(gpu).toEqual({ ok: true, free: REQUIRED_FREE_MIB + 200, unloaded: ['qwen3.5:9b'] })
    expect(calls).toContainEqual(['http://127.0.0.1:11434/api/generate', JSON.stringify({ model: 'qwen3.5:9b', keep_alive: 0 })])
  })

  it('names the processes holding the card when it is short', async () => {
    const { fetch } = ollama([])
    const gpu = await freeGpu({ fetch, exec: smi(8000), pollMs: 1 })
    expect(gpu).toEqual({ ok: false, free: 8000, holders: '1234, chatterbox, 3496 MiB', unloaded: [] })
  })

  it('goes on when Ollama is not running', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect((await freeGpu({ fetch, exec: smi(12000), pollMs: 1 })).ok).toBe(true)
  })
})

describe('describerEnv', () => {
  it('passes the process only what the describer needs, never a key', () => {
    const env = describerEnv({ PATH: '/bin', HOME: '/home/s-ci', EVAL_API_KEY: 'sk-secret', LANG: 'C.UTF-8' }, '/data/moondream3')
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/s-ci', LANG: 'C.UTF-8', HF_HOME: '/data/moondream3/hf', HF_HUB_OFFLINE: '1' })
  })
})
