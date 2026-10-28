import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_LOG_FILE, appendChatRecord, chatLogFileName, createChatLog, teeRelayUpstream, toLogRequest } from '../src/relay/chatLog.js'
import { tempDir } from './tempDir.js'

const record = (ts, extra = {}) => ({ ts, chatId: 'c', kind: 'openai', path: 'v1/chat/completions', status: 200, request: {}, response: 'x', ms: 1, ...extra })

describe('chatLogFileName', () => {
  it('names the UTC day and matches CHAT_LOG_FILE', () => {
    expect(chatLogFileName('2026-09-27T23:59:59.999Z')).toBe('2026-09-27.jsonl')
    expect(CHAT_LOG_FILE.test(chatLogFileName('2026-09-27T10:00:00.000Z'))).toBe(true)
    expect(CHAT_LOG_FILE.test('notes.txt')).toBe(false)
  })
})

describe('appendChatRecord', () => {
  it('writes one JSON line per record to a file named by the UTC day, creating the dir', () => {
    const dir = join(tempDir('chatlog-'), 'logs')
    appendChatRecord(dir, record('2026-09-27T10:00:00.000Z'))
    appendChatRecord(dir, record('2026-09-27T11:00:00.000Z'))
    const lines = readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).ts)).toEqual(['2026-09-27T10:00:00.000Z', '2026-09-27T11:00:00.000Z'])
  })

  it('keeps the optional inference and costUsd fields', () => {
    const dir = tempDir('chatlog-')
    appendChatRecord(dir, record('2026-09-27T10:00:00.000Z', { inference: 'deepseek-flash', costUsd: 0.0004 }))
    const line = JSON.parse(readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim())
    expect(line).toMatchObject({ inference: 'deepseek-flash', costUsd: 0.0004 })
  })

  it('warns and never throws when the dir cannot be created', () => {
    const base = tempDir('chatlog-')
    writeFileSync(join(base, 'file'), '')
    const warn = vi.fn()
    expect(() => appendChatRecord(join(base, 'file', 'logs'), record('2026-09-27T10:00:00.000Z'), { warn })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('toLogRequest', () => {
  it('drops tools from a JSON body and keeps an unparseable body as text', () => {
    expect(toLogRequest(Buffer.from(JSON.stringify({ model: 'm', tools: [{ name: 'eval' }] })))).toEqual({ model: 'm' })
    expect(toLogRequest(Buffer.from('not json'))).toBe('not json')
  })

  // A 3x2 PNG and a 5x4 baseline JPEG, just past the headers that carry their size.
  const pngBytes = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from([0, 0, 0, 3, 0, 0, 0, 2]), Buffer.alloc(8)])
  const jpegBytes = Buffer.concat([
    Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
    Buffer.from('ffc0001108', 'hex'),
    Buffer.from([0, 4, 0, 5]),
    Buffer.alloc(12),
  ])
  const pngUrl = `data:image/png;base64,${pngBytes.toString('base64')}`
  const jpegUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`
  const logged = (body) => toLogRequest(Buffer.from(JSON.stringify(body)))

  it('replaces chat-completions image parts with a text placeholder naming type and size', () => {
    const request = logged({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'like this' }, { type: 'image_url', image_url: { url: jpegUrl } }, { type: 'image_url', image_url: { url: pngUrl } }] }] })
    expect(request.messages[0].content).toEqual([
      { type: 'text', text: 'like this' },
      { type: 'text', text: '[image: image/jpeg, 5x4]' },
      { type: 'text', text: '[image: image/png, 3x2]' },
    ])
  })

  it('replaces anthropic image blocks, in user content and in tool results', () => {
    const block = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBytes.toString('base64') } }
    const request = logged({
      messages: [
        { role: 'user', content: [block, { type: 'text', text: 'like this' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: '{}' }, block] }] },
      ],
    })
    expect(request.messages[0].content).toEqual([{ type: 'text', text: '[image: image/png, 3x2]' }, { type: 'text', text: 'like this' }])
    expect(request.messages[1].content[0].content[1]).toEqual({ type: 'text', text: '[image: image/png, 3x2]' })
  })

  it('replaces responses input_image parts with input_text', () => {
    const request = logged({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }, { type: 'input_image', image_url: jpegUrl }] }] })
    expect(request.input[0].content).toEqual([{ type: 'input_text', text: 'hi' }, { type: 'input_text', text: '[image: image/jpeg, 5x4]' }])
  })

  it('names the type alone when the size cannot be read, and leaves a linked image as it is', () => {
    const request = logged({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/webp;base64,UklGRg==' } }, { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }] })
    expect(request.messages[0].content).toEqual([{ type: 'text', text: '[image: image/webp]' }, { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }])
    expect(JSON.stringify(logged({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: jpegUrl } }] }] }))).not.toContain('base64')
  })
})

describe('teeRelayUpstream', () => {
  it('builds the record from the streamed response, with no tools and no headers', () => {
    const dir = tempDir('chatlog-')
    const log = createChatLog(dir)
    const request = Buffer.from(JSON.stringify({ model: 'm', tools: [{ name: 'eval' }], messages: [] }))
    const tee = teeRelayUpstream({ log, ts: '2026-09-27T10:00:00.000Z', kind: 'openai', path: 'v1/chat/completions', chatId: 'c', request, started: Date.now() })
    tee.chunk(Buffer.from('data: hello\n\n'))
    tee.chunk(Buffer.from('data: world\n\n'))
    tee.finish(200)
    const line = JSON.parse(readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim())
    expect(line).toMatchObject({ chatId: 'c', kind: 'openai', path: 'v1/chat/completions', status: 200 })
    expect(line.request).toEqual({ model: 'm', messages: [] })
    expect(line.request).not.toHaveProperty('tools')
    expect(line.response).toBe('data: hello\n\ndata: world\n\n')
    // The record is exactly this field set: headers are never written.
    expect(Object.keys(line).sort()).toEqual(['chatId', 'kind', 'ms', 'path', 'request', 'response', 'status', 'ts'])
  })

  it('writes nothing and returns null when logging is off', () => {
    const tee = teeRelayUpstream({ log: null, ts: '2026-09-27T10:00:00.000Z', kind: 'openai', path: 'v1/chat/completions', request: Buffer.from('{}') })
    tee.chunk(Buffer.from('x'))
    expect(tee.finish(200)).toBeNull()
  })
})

describe('createChatLog', () => {
  it('warns once and never throws when the dir cannot be created', () => {
    const base = tempDir('chatlog-')
    writeFileSync(join(base, 'file'), '')
    const warn = vi.fn()
    const log = createChatLog(join(base, 'file', 'logs'), { warn })
    expect(() => log.write(record('2026-09-27T10:00:00.000Z'))).not.toThrow()
    log.write(record('2026-09-27T10:00:01.000Z'))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
