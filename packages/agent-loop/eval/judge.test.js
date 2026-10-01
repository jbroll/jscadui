import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { castVote, JUDGE, JUDGE_PROMPT_SHA256, judgeFiles, judgePrompt, parseVote, unjudgedRuns, verdictOf } from './judge.js'

// A scripted judge in the shape of eval/fake-provider.js: each reply in order, an Error thrown as a provider failure.
const replies = (...texts) => {
  const queue = [...texts]
  return () => ({
    async *send() {
      const next = queue.shift()
      if (next instanceof Error) throw next
      yield { type: 'text', text: next ?? '' }
      yield { type: 'done', stopReason: 'stop' }
    },
  })
}
const clock = () => {
  let t = 0
  return () => (t += 100)
}

const described = (overrides = {}) => ({
  fixture: 'caboose',
  run: 1,
  userMessages: ['we need a model of a toy caboose'],
  gates: [
    { name: 'builds', pass: true },
    { name: 'watertight', pass: true },
    { name: 'connected', pass: true, groups: 1 },
  ],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.75 },
  render: { meshSha256: 'a'.repeat(64), facts: { dimensions: [111, 41, 67], bodies: 62 }, views: [] },
  description: { text: 'side view: a red caboose', views: [] },
  verdict: null,
  verdictPending: true,
  ...overrides,
})
const fileWith = (runs) => {
  const path = join(mkdtempSync(join(tmpdir(), 'judge-test-')), 'r.json')
  writeFileSync(path, JSON.stringify({ suite: 'complex', summary: [], results: runs }))
  return path
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

const OLD_JUDGE_PROMPT_SHA256 = '53b0d5725e4b35bfe5133bd65cd5806496851bbe7e519990b03077a91ed9e1e7'

describe('the judge prompt', () => {
  const run = (overrides = {}) => ({
    messages: ['a model rocket about 20cm tall'],
    description: 'side view: a rocket',
    facts: { dimensions: [100, 50, 300] },
    groups: 1,
    ...overrides,
  })

  it('quotes each message, states the measured size and piece count, flags the separately-described views, then asks the question', () => {
    expect(judgePrompt(run())).toBe(
      'The user\'s message(s):\n"a model rocket about 20cm tall"\n\n' +
        'Measured result: overall size 100 x 50 x 300 mm, 1 separate piece(s).\n\n' +
        'A describer looked at four renders of the result (front three-quarter, back three-quarter, a raised side view and a view from above) and described each view on its own, without seeing the request. It can misread a single view, so the views may disagree; judge the object they describe together. The describer does not know what the object is for and often names it by its shape alone ("a box with holes", "a U-shaped bracket"); judge whether the shapes and parts it describes would do what the user asked for, not whether it uses the user\'s words.\n' +
        'side view: a rocket\n\n' +
        'Did the result succeed at what the user asked for? Answer SUCCESS if the user who made the request would accept the model as what they asked for. A generic shape, missing major parts, or parts floating apart are FAILURE. Still renders cannot show motion or removal: a visible hinge, pivot, or separate piece counts for a part that moves or comes off, and a fitting counts when its opening or shape is there. Do not fail it for colours, style, or details the user did not ask for. Answer SUCCESS or FAILURE, then one line why.',
    )
  })

  it('quotes every message in order', () => {
    expect(judgePrompt(run({ messages: ['a model rocket about 20cm tall', 'can you make it two stages, with fins only on the bottom one'] }))).toContain(
      '"a model rocket about 20cm tall"\n"can you make it two stages, with fins only on the bottom one"',
    )
  })

  it('drops the whole measured line when neither dimensions nor groups are known', () => {
    expect(judgePrompt(run({ facts: null, groups: null }))).not.toContain('Measured result')
  })

  it('drops only the missing clause when one of dimensions or groups is known', () => {
    expect(judgePrompt(run({ groups: null }))).toContain('Measured result: overall size 100 x 50 x 300 mm.\n\n')
    expect(judgePrompt(run({ facts: null }))).toContain('Measured result: 1 separate piece(s).\n\n')
  })

  it('reads a real run: userMessages, description.text, render.facts.dimensions and the connected gate\'s groups', () => {
    const fullRun = {
      userMessages: ['we need a model of a toy caboose'],
      description: { text: 'side view: a red caboose' },
      render: { facts: { dimensions: [111, 41, 67] } },
      gates: [
        { name: 'builds', pass: true },
        { name: 'connected', pass: true, groups: 1 },
      ],
    }
    expect(judgePrompt(fullRun)).toContain('Measured result: overall size 111 x 41 x 67 mm, 1 separate piece(s).')
    expect(judgePrompt(fullRun)).toContain('side view: a red caboose')
  })

  it('hashes the template with placeholders, different from the old prompt\'s hash', () => {
    expect(JUDGE_PROMPT_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(JUDGE_PROMPT_SHA256).not.toBe(OLD_JUDGE_PROMPT_SHA256)
  })
})

describe('votes', () => {
  it('takes the first SUCCESS or FAILURE and the rest as the reason', () => {
    expect(parseVote('SUCCESS — the model is a recognizable toy caboose')).toEqual({ success: true, reason: 'the model is a recognizable toy caboose' })
    expect(parseVote('**FAILURE**: a plain red box')).toEqual({ success: false, reason: 'a plain red box' })
    expect(parseVote('FAILURE - x'.padEnd(300, 'y')).reason).toHaveLength(200)
    expect(parseVote('I think it is fine')).toBeNull()
  })

  it('asks again after a reply with neither word or a provider error, up to twice', async () => {
    expect(await castVote(replies('hmm', 'FAILURE - no roof')(), 'p', clock())).toEqual({ success: false, reason: 'no roof', ms: 100 })
    expect((await castVote(replies(new Error('status 500'), 'SUCCESS — fine')(), 'p')).success).toBe(true)
    expect(await castVote(replies('eh', 'eh', 'still unsure')(), 'p', clock())).toEqual({ success: null, reason: 'still unsure', ms: 100 })
  })

  it('needs two agreeing votes for a verdict', () => {
    const v = (success) => ({ success })
    expect(verdictOf([v(true), v(true), v(false)])).toEqual({ success: true, votes: [2, 1] })
    expect(verdictOf([v(false), v(false), v(false)])).toEqual({ success: false, votes: [0, 3] })
    expect(verdictOf([v(true), v(false), v(null)])).toBeNull()
    expect(verdictOf([v(true), v(null), v(null)])).toBeNull()
  })
})

describe('unjudgedRuns', () => {
  it('picks described runs with no verdict, or every described run with all', () => {
    const file = {
      suite: 'complex',
      results: [described(), described({ verdict: { success: true, votes: [3, 0] } }), described({ description: null }), described({ graderError: true }), described({ renderStale: true })],
    }
    expect(unjudgedRuns(file)).toEqual([file.results[0]])
    expect(unjudgedRuns(file, { all: true })).toEqual([file.results[0], file.results[1], file.results[3]])
  })
})

describe('judgeFiles', () => {
  it('records the votes and the majority, and settles geometry and the summary', async () => {
    const path = fileWith([described()])
    const outcome = await judgeFiles([path], { makeProvider: replies('SUCCESS — a caboose', 'SUCCESS — yes', 'FAILURE — no cupola'), concurrency: 1 })
    expect(outcome).toEqual({ judged: 1, graderErrors: 0 })
    const file = read(path)
    const [run] = file.results
    expect(run.votes.map((v) => v.success)).toEqual([true, true, false])
    expect(run.verdict).toEqual({ success: true, votes: [2, 1] })
    expect(run.verdictPending).toBeUndefined()
    expect(run.report.dimensions.geometry).toBe(2)
    expect(run.report.total).toBe(8)
    expect(run.report.checkRate).toBe(1)
    expect(file.judge).toEqual({ provider: JUDGE.provider, model: JUDGE.model, promptSha256: JUDGE_PROMPT_SHA256 })
    expect(file.summary[0].verdictRate).toBe(1)
  })

  it('marks a split judge as a graderError with no verdict', async () => {
    const path = fileWith([described()])
    const outcome = await judgeFiles([path], { makeProvider: replies('SUCCESS', 'FAILURE', 'eh', 'eh', 'eh'), concurrency: 1 })
    expect(outcome).toEqual({ judged: 0, graderErrors: 1 })
    const [run] = read(path).results
    expect(run.graderError).toBe(true)
    expect(run.verdict).toBeNull()
    expect(run.verdictPending).toBeUndefined()
    expect(run.report.dimensions.geometry).toBe(0)
  })

  it('judges a judged run again only with all', async () => {
    const path = fileWith([described({ verdict: { success: true, votes: [3, 0] }, verdictPending: undefined })])
    expect(await judgeFiles([path], { makeProvider: replies() })).toEqual({ judged: 0, graderErrors: 0 })
    await judgeFiles([path], { all: true, makeProvider: replies('FAILURE — box', 'FAILURE — box', 'FAILURE — box'), concurrency: 1 })
    expect(read(path).results[0].verdict).toEqual({ success: false, votes: [0, 3] })
  })
})
