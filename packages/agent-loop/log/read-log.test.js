import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatConversations, readConversations } from './read-log.js'

const sse = (...events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const openaiCall = (id, name, args) =>
  sse({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]')
const openaiText = (text) => sse({ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]')
const anthropicText = (text) =>
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } })
const responsesCall = (callId, name, args) =>
  sse(
    { type: 'response.output_item.added', item: { id: 'item_1', type: 'function_call', call_id: callId, name } },
    { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: JSON.stringify(args) },
    { type: 'response.completed' },
  )

const rec = (ts, chatId, path, request, response, status = 200) => ({ ts, chatId, kind: 'k', path, status, request, response, ms: 5 })
const sys = { role: 'system', content: 'S' }
const fluentPrompt = '# Prompt\n\n## jscad-fluent style\n\nChain methods.'
const modelingPrompt = '# Prompt\n\n## @jscad/modeling style\n\nPass shapes in.'
const bothStylesPrompt = '# Prompt\n\n## jscad-fluent style\n\n## @jscad/modeling style\n'
const ask = { role: 'user', content: 'A single sphere' }
const call = (id, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const result = (id, body) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(body) })
const bad = { source: "import { sphere } from '@jscad/primitives'" }
const good = { source: "const { primitives } = require('@jscad/modeling')" }
const fail = { ok: false, error: { name: 'Error', message: 'failed to load module @jscad/primitives' } }
const OAI = 'v1/chat/completions'

const writeLog = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'readlog-'))
  for (const [name, records] of Object.entries(files)) {
    writeFileSync(join(dir, name), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  }
  return dir
}

const openaiChat = [
  rec('2026-09-27T10:00:00.000Z', 'chat-1', OAI, { model: 'm', messages: [sys, ask] }, openaiCall('c1', 'eval', bad)),
  rec('2026-09-27T10:00:01.000Z', 'chat-1', OAI, { model: 'm', messages: [sys, ask, call('c1', 'eval', bad), result('c1', fail)] }, openaiCall('c2', 'eval', good)),
  rec(
    '2026-09-27T10:00:02.000Z',
    'chat-1',
    OAI,
    { model: 'm', messages: [sys, ask, call('c1', 'eval', bad), result('c1', fail), call('c2', 'eval', good), result('c2', { entityCount: 1 })] },
    openaiText('Here is a sphere.'),
  ),
  rec(
    '2026-09-27T10:01:00.000Z',
    'chat-1',
    OAI,
    { model: 'm', messages: [sys, ask, { role: 'assistant', content: 'Here is a sphere.' }, { role: 'user', content: 'Make it bigger' }] },
    openaiText('Done.'),
  ),
]

describe('readConversations', () => {
  it('rebuilds an openai conversation into turns with failed and good steps', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': openaiChat })
    const [conversation] = await readConversations(dir)
    expect(conversation.chatId).toBe('chat-1')
    expect(conversation.model).toBe('m')
    expect(conversation.turns).toEqual([
      {
        ts: '2026-09-27T10:00:00.000Z',
        user: 'A single sphere',
        steps: [
          { name: 'eval', input: bad, result: JSON.stringify(fail), ok: false, error: 'failed to load module @jscad/primitives' },
          { name: 'eval', input: good, result: JSON.stringify({ entityCount: 1 }), ok: true },
        ],
        final: 'Here is a sphere.',
      },
      { ts: '2026-09-27T10:01:00.000Z', user: 'Make it bigger', steps: [], final: 'Done.' },
    ])
  })

  it('reads anthropic tool results out of user blocks', async () => {
    const request = {
      model: 'claude',
      system: 'S',
      messages: [
        { role: 'user', content: 'A cube' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":false,"error":{"message":"boom"}}' }] },
      ],
    }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'chat-2', 'v1/messages', request, anthropicText('Sorry.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.turns[0]).toMatchObject({ user: 'A cube', final: 'Sorry.', steps: [{ name: 'eval', ok: false, error: 'boom' }] })
  })

  it('gives each record without a chat id its own conversation, with an unanswered call', async () => {
    const request = { model: 'muse', input: [{ role: 'system', content: 'S' }, { role: 'user', content: 'A sphere' }] }
    const dir = writeLog({
      '2026-09-27.jsonl': [
        rec('2026-09-27T10:00:00.000Z', null, 'v1/responses', request, responsesCall('r1', 'eval', { source: 'y' })),
        rec('2026-09-27T10:00:05.000Z', null, 'v1/responses', request, responsesCall('r2', 'eval', { source: 'z' })),
      ],
    })
    const conversations = await readConversations(dir)
    expect(conversations).toHaveLength(2)
    expect(conversations[0].chatId).toBeNull()
    expect(conversations[0].turns[0]).toEqual({
      ts: '2026-09-27T10:00:00.000Z',
      user: 'A sphere',
      steps: [{ name: 'eval', input: { source: 'y' }, result: null, ok: null }],
      final: null,
    })
  })

  it('keeps an HTTP failure as the turn error', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', OAI, { model: 'm', messages: [sys, ask] }, '{"error":"bad key"}', 401)] })
    const [conversation] = await readConversations(dir)
    expect(conversation.turns[0]).toMatchObject({ user: 'A single sphere', final: null, error: '{"error":"bad key"}' })
  })

  it('reads only records at or after since, across files', async () => {
    const dir = writeLog({
      '2026-09-26.jsonl': [rec('2026-09-26T10:00:00.000Z', 'old', OAI, { model: 'm', messages: [sys, ask] }, openaiText('a'))],
      '2026-09-27.jsonl': openaiChat,
    })
    const conversations = await readConversations(dir, { since: '2026-09-27T00:00:00Z' })
    expect(conversations.map((c) => c.chatId)).toEqual(['chat-1'])
  })

  it('returns nothing for a missing dir', async () => {
    expect(await readConversations(join(tmpdir(), 'no-such-chat-log-dir'))).toEqual([])
  })
})

describe('conversation api style', () => {
  it('reads the anthropic system field', async () => {
    const request = { model: 'claude', system: fluentPrompt, messages: [ask] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', 'v1/messages', request, anthropicText('Ok.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('fluent')
  })

  it('reads the leading system message for chat completions', async () => {
    const request = { model: 'm', messages: [{ role: 'system', content: modelingPrompt }, ask] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', OAI, request, openaiText('Ok.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('modeling')
  })

  it('reads request.instructions for the responses api', async () => {
    const request = { model: 'muse', instructions: fluentPrompt, input: [{ role: 'user', content: 'A sphere' }] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', 'v1/responses', request, responsesCall('r1', 'eval', { source: 'y' }))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('fluent')
  })

  it('reads a leading system item in responses input', async () => {
    const request = { model: 'muse', input: [{ role: 'system', content: modelingPrompt }, { role: 'user', content: 'A sphere' }] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', 'v1/responses', request, responsesCall('r1', 'eval', { source: 'y' }))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('modeling')
  })

  it('is unknown for a pre-split prompt that taught both styles', async () => {
    const request = { model: 'm', messages: [{ role: 'system', content: bothStylesPrompt }, ask] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', OAI, request, openaiText('Ok.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('unknown')
  })

  it('is unknown for a log with no system prompt at all', async () => {
    const request = { model: 'm', messages: [ask] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', OAI, request, openaiText('Ok.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.api).toBe('unknown')
  })

  it('prints the style in the summary header', async () => {
    const request = { model: 'claude', system: fluentPrompt, messages: [ask] }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', 'v1/messages', request, anthropicText('Ok.'))] })
    const text = formatConversations(await readConversations(dir))
    expect(text).toContain('== c  claude  fluent  2026-09-27T10:00:00.000Z')
  })
})

describe('formatConversations', () => {
  it('prints each failed call with its error and source', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': openaiChat })
    const text = formatConversations(await readConversations(dir))
    expect(text).toContain('== chat-1')
    expect(text).toContain('> A single sphere')
    expect(text).toContain('eval FAILED')
    expect(text).toContain('error: failed to load module @jscad/primitives')
    expect(text).toContain("| import { sphere } from '@jscad/primitives'")
    expect(text).toContain('< Here is a sphere.')
  })

  it('prints the code of a failed write, edit or run', () => {
    const failed = (name, input) => ({ name, input, result: null, ok: false, error: 'boom' })
    const conversations = [
      {
        chatId: 'c',
        model: 'm',
        turns: [
          {
            ts: 't',
            user: 'u',
            steps: [
              failed('write', { path: 'main.js', content: 'const a = 1' }),
              failed('edit', { path: 'main.js', oldString: 'a = 1', newString: 'a = 2' }),
              failed('run', { source: 'console.log(a)' }),
            ],
          },
        ],
      },
    ]
    const text = formatConversations(conversations)
    expect(text).toContain('    write FAILED\n      error: boom\n      main.js\n      | const a = 1')
    expect(text).toContain('    edit FAILED\n      error: boom\n      main.js\n      - a = 1\n      + a = 2')
    expect(text).toContain('    run FAILED\n      error: boom\n      | console.log(a)')
  })
})
