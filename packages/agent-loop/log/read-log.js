// Usage: node log/read-log.js [--since ISO] [--json]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatLogDir } from './log-dir.js'
import { apiStyleOf, requestMessages, responseMessage } from './wire.js'

const listLogFiles = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
  } catch {
    return []
  }
}

const readRecords = (dir, since) => {
  const records = []
  for (const file of listLogFiles(dir)) {
    if (since && file.slice(0, 10) < since.slice(0, 10)) continue
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        // a line cut short by a crash mid-write
      }
    }
  }
  return records
    .filter((r) => r.request !== null && typeof r.request === 'object' && (!since || r.ts >= since))
    .sort((a, b) => a.ts.localeCompare(b.ts))
}

const isUserText = (m) => m?.role === 'user' && typeof m.content === 'string'

const failureOf = (content) => {
  try {
    const parsed = JSON.parse(content)
    return parsed?.ok === false ? (parsed.error?.message ?? 'failed') : null
  } catch {
    return null
  }
}

const stepsOf = (messages) => {
  const results = new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m.content]))
  return messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.toolCalls ?? [])
    .map((call) => {
      const result = results.get(call.id) ?? null
      const error = result === null ? null : failureOf(result)
      return { name: call.name, input: call.input, result, ok: result === null ? null : error === null, ...(error === null ? {} : { error }) }
    })
}

const buildTurn = async (records) => {
  const last = records.at(-1)
  const response = await responseMessage(last)
  const messages = [...requestMessages(last), ...(response.message ? [response.message] : [])]
  const at = messages.findLastIndex(isUserText)
  return {
    ts: records[0].ts,
    user: at === -1 ? null : messages[at].content,
    steps: stepsOf(messages.slice(at + 1)),
    final: response.message?.content ?? null,
    ...(response.error === undefined ? {} : { error: response.error }),
  }
}

// A request whose last message is the user's own text opens a turn; tool rounds continue it.
const turnsOf = async (records) => {
  const turns = []
  let current = []
  for (const record of records) {
    if (current.length > 0 && isUserText(requestMessages(record).at(-1))) {
      turns.push(await buildTurn(current))
      current = []
    }
    current.push(record)
  }
  if (current.length > 0) turns.push(await buildTurn(current))
  return turns
}

export const readConversations = async (dir, { since } = {}) => {
  const records = readRecords(dir, since && new Date(since).toISOString())
  const groups = new Map()
  for (const record of records) {
    const key = record.chatId ?? Symbol('no chat id')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  const conversations = []
  for (const [key, list] of groups) {
    conversations.push({ chatId: typeof key === 'string' ? key : null, model: list[0].request.model ?? null, api: apiStyleOf(list[0]), turns: await turnsOf(list) })
  }
  return conversations
}

const clip = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text)

const marked = (mark, text) => text.split('\n').map((line) => `      ${mark} ${line}`)

// The code a failed call carried: a run's or older eval's source, a write's
// content, an edit's replacement.
const codeOf = ({ path, source, content, oldString, newString }) => {
  const file = typeof path === 'string' ? [`      ${path}`] : []
  if (typeof source === 'string') return marked('|', source)
  if (typeof content === 'string') return [...file, ...marked('|', content)]
  if (typeof oldString === 'string' && typeof newString === 'string') return [...file, ...marked('-', oldString), ...marked('+', newString)]
  return []
}

export const formatConversations = (conversations) => {
  const lines = []
  for (const c of conversations) {
    lines.push(`== ${c.chatId ?? '(no chat id)'}  ${c.model ?? ''}  ${c.api}  ${c.turns[0]?.ts ?? ''}`)
    for (const turn of c.turns) {
      lines.push(`  > ${clip(turn.user ?? '', 200)}`)
      for (const step of turn.steps) {
        lines.push(`    ${step.name} ${step.ok === false ? 'FAILED' : step.ok === null ? 'no result' : 'ok'}`)
        if (step.ok !== false) continue
        lines.push(`      error: ${step.error}`)
        lines.push(...codeOf(step.input ?? {}))
      }
      if (turn.error) lines.push(`  ! ${clip(turn.error, 300)}`)
      if (turn.final) lines.push(`  < ${clip(turn.final, 200)}`)
    }
  }
  return lines.join('\n')
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--since')
  const dir = chatLogDir()
  if (!dir) {
    console.error('read-log: JSCAD_CHAT_LOG=0, logging is off')
    process.exit(1)
  }
  const conversations = await readConversations(dir, { since: at === -1 ? undefined : args[at + 1] })
  console.log(args.includes('--json') ? JSON.stringify(conversations, null, 2) : formatConversations(conversations))
}
