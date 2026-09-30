import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { APIS } from '../src/api.js'
import { buildSystemPrompt } from '../src/prompt.js'
import { buildTools } from '../src/tools.js'
import { createEvalBackend } from './backend.js'
import { startExecutor } from './sandbox.js'
import { compareApis, evalApi, regradeResults, resultFileName, runSuite, saveResults, selectFixtures } from './run-eval.js'

const fixture = { name: 'x', prompt: 'p', requires: ['write'], verifyBeforeWrite: false, maxTurns: 2, checks: () => [] }

describe('EVAL_API', () => {
  it('defaults to fluent and reads EVAL_API', () => {
    expect(evalApi({})).toBe('fluent')
    expect(evalApi({ EVAL_API: 'modeling' })).toBe('modeling')
  })

  it('refuses an unknown style', () => {
    expect(() => evalApi({ EVAL_API: 'openscad' })).toThrow(/unknown api openscad/)
  })

  it('ci/eval.conf runs every style', () => {
    const conf = readFileSync(new URL('../../../ci/eval.conf', import.meta.url), 'utf8')
    const apis = /^EVAL_APIS="([^"]*)"/m.exec(conf)[1].split(/\s+/)
    expect(apis).toEqual(APIS)
  })
})

describe('selectFixtures by api', () => {
  const neutral = { name: 'cube-hole' }
  const fluentOnly = { name: 'fluent-chain', api: 'fluent' }
  const modelingOnly = { name: 'plain-calls', api: 'modeling' }
  const all = [neutral, fluentOnly, modelingOnly]

  it('runs neutral fixtures and those declaring the chosen api', () => {
    expect(selectFixtures(all, null, 'fluent')).toEqual([neutral, fluentOnly])
    expect(selectFixtures(all, null, 'modeling')).toEqual([neutral, modelingOnly])
  })

  it('drops a named fixture of the other api', () => {
    expect(selectFixtures(all, ['fluent-chain', 'cube-hole'], 'modeling')).toEqual([neutral])
  })

  it("starts a fixture with per-api files from the chosen api's files", () => {
    const perApi = { name: 'edit', apiFiles: { fluent: { 'main.js': 'fluent' }, modeling: { 'main.js': 'modeling' } } }
    expect(selectFixtures([perApi], null, 'fluent')[0].files).toEqual({ 'main.js': 'fluent' })
    expect(selectFixtures([perApi], null, 'modeling')[0].files).toEqual({ 'main.js': 'modeling' })
  })
})

describe('result files', () => {
  it('put the api in the file name', () => {
    const now = new Date('2026-09-28T14:05:07.123Z')
    expect(resultFileName('deepseek', 'modeling', 'abcd1234ef567890', now)).toBe('2026-09-28T140507Z-deepseek-modeling-abcd1234.json')
  })

  it('record the api', () => {
    const writes = []
    saveResults((_path, content) => writes.push(JSON.parse(content)), '/fake/path.json', {
      model: 'm', provider: 'p', api: 'modeling', runs: 1, promptSha256: 'sha', results: [],
    })
    expect(writes[0].api).toBe('modeling')
  })

  it('have a prompt hash per api', () => {
    expect(buildSystemPrompt('fluent')).not.toBe(buildSystemPrompt('modeling'))
  })
})

describe('compareApis', () => {
  it('refuses files from different styles', () => {
    expect(compareApis({ api: 'fluent' }, { api: 'modeling' })).toEqual({ error: 'run-eval: cannot compare a fluent result with a modeling result' })
  })

  it('warns when a file predates the api setting', () => {
    expect(compareApis({}, { api: 'fluent' })).toEqual({ warning: 'run-eval: a has no api (written before the api setting); b is fluent' })
    expect(compareApis({ api: 'modeling' }, {})).toEqual({ warning: 'run-eval: a is modeling; b has no api (written before the api setting)' })
  })

  it('passes files of one style', () => {
    expect(compareApis({ api: 'fluent' }, { api: 'fluent' })).toEqual({})
  })
})

describe('regrade under the recorded api', () => {
  const file = (api) => ({ ...(api ? { api } : {}), results: [{ fixture: 'x', run: 1, transcript: [{ role: 'user', content: 'p' }], report: { dimensions: {} }, metrics: {} }] })
  const recording = () => {
    const asked = []
    const graderFor = (api) => {
      asked.push(api)
      return { gradeProject: async () => ({ measure: null, solid: null, params: [] }) }
    }
    return { asked, graderFor }
  }

  it('grades each file under its own api, and a file without one as fluent', async () => {
    const { asked, graderFor } = recording()
    const fixtures = new Map([['x', fixture]])
    await regradeResults(file('modeling'), fixtures, { graderFor })
    await regradeResults(file(), fixtures, { graderFor })
    expect(asked).toEqual(['modeling', 'fluent'])
  })

  it("grades a fixture with per-api files over the file's api files", async () => {
    const seen = []
    const graderFor = () => ({ gradeProject: async (model) => (seen.push(model.files), { measure: null, solid: null, params: [] }) })
    const perApi = { ...fixture, name: 'x', requires: ['write'], apiFiles: { fluent: { 'main.js': 'F', 'part.js': 'f' }, modeling: { 'main.js': 'M', 'part.js': 'm' } } }
    const written = (api) => ({ api, results: [{ fixture: 'x', run: 1, transcript: [{ role: 'user', content: 'p' }, { role: 'assistant', content: null, toolCalls: [{ id: 't', name: 'writeModel', input: { source: 'new' } }] }], report: { dimensions: {} }, metrics: {} }] })
    await regradeResults(written('modeling'), new Map([['x', perApi]]), { graderFor })
    await regradeResults(written('fluent'), new Map([['x', perApi]]), { graderFor })
    expect(seen).toEqual([{ 'main.js': 'new', 'part.js': 'm' }, { 'main.js': 'new', 'part.js': 'f' }])
  })

  it('an executor child gets its api over IPC', async () => {
    const grader = startExecutor({ api: 'modeling', sandbox: { kind: 'child' } })
    try {
      expect(await grader.ready).toBe('modeling')
    } finally {
      grader.close()
    }
  }, 30_000)
})

describe('a conversation under an api', () => {
  it('sends that api prompt and tools and records the api', async () => {
    const seen = []
    const provider = {
      async *send(messages, tools) {
        seen.push({ system: messages[0].content, tools })
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend({ api: 'modeling' }), api: 'modeling' })
    expect(seen[0].system).toBe(buildSystemPrompt('modeling'))
    expect(seen[0].tools).toEqual(buildTools('modeling'))
    expect(result.api).toBe('modeling')
  })

  it('defaults to fluent', async () => {
    const seen = []
    const provider = {
      async *send(messages) {
        seen.push(messages[0].content)
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(seen[0]).toBe(buildSystemPrompt('fluent'))
    expect(result.api).toBe('fluent')
  })

  it('answers docs from that api', async () => {
    expect(await createEvalBackend({ api: 'modeling' }).requestTool('docs', { query: 'jf.cube' })).toMatch(/^jf\.cube is not part of the modeling API/)
    expect(await createEvalBackend().requestTool('docs', { query: 'cube' })).toMatch(/^jf\.cube \(@jbroll\/jscad-fluent\)/)
  })
})
