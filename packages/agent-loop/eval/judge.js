// Usage: npm run judge -w @jscadui/agent-loop -- [--all] <result files>
// Stage C of the complex eval (docs/architecture.md, The judge); npm runs it in packages/agent-loop, so give absolute paths.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isMainModule } from '../src/mainModule.js'
import { createProvider } from '../src/providers.js'
import { settleRun } from './complex.js'
import { resolveCredentials } from './credentials.js'
import { runPool } from './parallel.js'
import { summarize } from './report.js'

export const JUDGE = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
export const JUDGE_CALLS = 3
export const JUDGE_MAX_TOKENS = 150
const MAX_ATTEMPTS = 3
const REASON_CHARS = 200
const JUDGE_CONCURRENCY = 8

export const JUDGE_QUESTION =
  'Did the result succeed at what the user asked for? Answer SUCCESS if the user who made the request would accept the model as what they asked for. A generic shape, missing major parts, or parts floating apart are FAILURE. Still renders cannot show motion or removal: a visible hinge, pivot, or separate piece counts for a part that moves or comes off, and a fitting counts when its opening or shape is there. Do not fail it for colours, style, or details the user did not ask for. Answer SUCCESS or FAILURE, then one line why.'

const DESCRIBER_INTRO =
  'A describer looked at three renders of the result (front three-quarter, back three-quarter and a raised side view) and described each view on its own, without seeing the request. It can misread a single view, so the views may disagree; judge the object they describe together. The describer does not know what the object is for and often names it by its shape alone ("a box with holes", "a U-shaped bracket"); judge whether the shapes and parts it describes would do what the user asked for, not whether it uses the user\'s words.'

const groupsOf = (gates) => gates?.find((g) => g.name === 'connected')?.groups ?? null

// Takes a run ({ userMessages, description: { text }, render: { facts }, gates }) or the
// plain shape ({ messages, description, facts, groups }) the sha below uses with placeholders.
export const judgePrompt = (run) => {
  const messages = run.messages ?? run.userMessages ?? []
  const description = typeof run.description === 'string' ? run.description : run.description?.text ?? ''
  const facts = 'facts' in run ? run.facts : run.render?.facts ?? null
  const groups = 'groups' in run ? run.groups : groupsOf(run.gates)
  const clauses = []
  if (Array.isArray(facts?.dimensions) && facts.dimensions.length === 3) clauses.push(`overall size ${facts.dimensions.join(' x ')} mm`)
  if (groups != null) clauses.push(`${groups} separate piece(s)`)
  const messagesBlock = `The user's message(s):\n${messages.map((m) => `"${m}"`).join('\n')}`
  const measured = clauses.length ? `Measured result: ${clauses.join(', ')}.` : null
  const describerBlock = `${DESCRIBER_INTRO}\n${description}`
  return [messagesBlock, measured, describerBlock, JUDGE_QUESTION].filter(Boolean).join('\n\n')
}

export const JUDGE_PROMPT_SHA256 = createHash('sha256')
  .update(judgePrompt({ messages: ['{message 1}', '{message 2}'], description: '{description}', facts: { dimensions: ['{W}', '{D}', '{H}'] }, groups: '{G}' }))
  .digest('hex')

export const parseVote = (text) => {
  const found = /SUCCESS|FAILURE/.exec(text ?? '')
  if (!found) return null
  const reason = text
    .slice(found.index + found[0].length)
    .replace(/^[\s*:.,;—–-]+/, '')
    .trim()
    .slice(0, REASON_CHARS)
  return { success: found[0] === 'SUCCESS', reason }
}

const replyOf = async (provider, prompt) => {
  let text = ''
  for await (const event of provider.send([{ role: 'user', content: prompt }], [])) {
    if (event.type === 'text') text += event.text
  }
  return text
}

// A reply with neither word, or a provider error that outlived the adapter's own retries, is asked again up to twice.
export const castVote = async (provider, prompt, now = () => performance.now()) => {
  const started = now()
  let last = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      last = await replyOf(provider, prompt)
    } catch (error) {
      last = `provider error: ${error.message}`
      continue
    }
    const vote = parseVote(last)
    if (vote) return { ...vote, ms: Math.round(now() - started) }
  }
  return { success: null, reason: last.trim().slice(0, REASON_CHARS), ms: Math.round(now() - started) }
}

export const verdictOf = (votes) => {
  const yes = votes.filter((v) => v.success === true).length
  const no = votes.filter((v) => v.success === false).length
  return Math.max(yes, no) < 2 ? null : { success: yes > no, votes: [yes, no] }
}

export const unjudgedRuns = (file, { all = false } = {}) =>
  file?.suite !== 'complex'
    ? []
    : file.results.filter((r) => typeof r.description?.text === 'string' && !r.renderStale && (all || (r.verdict == null && !r.graderError)))

export const judgeRun = async (run, { makeProvider, now }) => {
  const prompt = judgePrompt(run)
  const votes = []
  for (let call = 0; call < JUDGE_CALLS; call += 1) votes.push(await castVote(makeProvider(), prompt, now))
  const verdict = verdictOf(votes)
  const { graderError: _graderError, ...rest } = run
  return settleRun({ ...rest, votes, verdict, ...(verdict ? {} : { graderError: true }) })
}

export async function judgeFiles(paths, { all = false, makeProvider, log = () => {}, concurrency = JUDGE_CONCURRENCY, now } = {}) {
  const outcome = { judged: 0, graderErrors: 0 }
  for (const path of paths) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    if (file.suite !== 'complex') {
      log(`judge: ${path} is not a complex result file; skipped`)
      continue
    }
    const runs = unjudgedRuns(file, { all })
    if (runs.length === 0) continue
    await runPool(runs, concurrency, async (run) => {
      const judged = await judgeRun(run, { makeProvider, now })
      file.results[file.results.indexOf(run)] = judged
      outcome[judged.graderError ? 'graderErrors' : 'judged'] += 1
      const said = judged.verdict ? `${judged.verdict.success ? 'SUCCESS' : 'FAILURE'} ${judged.verdict.votes.join('-')}` : 'no majority (graderError)'
      log(`judge: ${run.fixture}#${run.run} ${said}`)
    })
    file.judge = { provider: JUDGE.provider, model: JUDGE.model, promptSha256: JUDGE_PROMPT_SHA256 }
    if (file.summary) file.summary = summarize(file.results)
    writeFileSync(path, JSON.stringify(file, null, 2))
  }
  return outcome
}

// The key comes from the same keys.json lookup as the eval's providers and never leaves this process.
export const judgeProviderFactory = () => {
  const { apiKey, baseUrl } = resolveCredentials({ EVAL_PROVIDER: JUDGE.provider })
  if (!apiKey) throw new Error(`no ${JUDGE.provider} key: put it in ~/.config/jscad-chat/keys.json (or point JSCAD_CHAT_KEYS at one)`)
  return () => createProvider({ kind: JUDGE.provider, model: JUDGE.model, apiKey, baseUrl, effort: 'none', temperature: 0, maxTokens: JUDGE_MAX_TOKENS })
}

const USAGE = 'Usage: npm run judge -w @jscadui/agent-loop -- [--all] <result files>'

const main = async (argv) => {
  const paths = argv.filter((arg) => !arg.startsWith('--'))
  if (paths.length === 0) {
    console.error(USAGE)
    process.exit(1)
  }
  try {
    const outcome = await judgeFiles(paths, { all: argv.includes('--all'), makeProvider: judgeProviderFactory(), log: console.log })
    console.log(`judge: ${outcome.judged} judged, ${outcome.graderErrors} with no majority`)
  } catch (error) {
    console.error(`judge: ${error.message}`)
    process.exit(1)
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2))
}
