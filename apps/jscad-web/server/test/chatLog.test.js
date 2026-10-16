import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendChatRecord, createChatLog, teeRelayUpstream, toLogRequest } from '../src/relay/chatLog.js'

const record = (ts, extra = {}) => ({ ts, chatId: 'c', kind: 'openai', path: 'v1/chat/completions', status: 200, request: {}, response: 'x', ms: 1, ...extra })

describe('appendChatRecord', () => {
  it('writes one JSON line per record to a file named by the UTC day, creating the dir', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'chatlog-')), 'logs')
    appendChatRecord(dir, record('2026-09-27T10:00:00.000Z'))
    appendChatRecord(dir, record('2026-09-27T11:00:00.000Z'))
    const lines = readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).ts)).toEqual(['2026-09-27T10:00:00.000Z', '2026-09-27T11:00:00.000Z'])
  })

  it('keeps the optional inference and costUsd fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlog-'))
    appendChatRecord(dir, record('2026-09-27T10:00:00.000Z', { inference: 'deepseek-flash', costUsd: 0.0004 }))
    const line = JSON.parse(readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim())
    expect(line).toMatchObject({ inference: 'deepseek-flash', costUsd: 0.0004 })
  })

  it('warns and never throws when the dir cannot be created', () => {
    const base = mkdtempSync(join(tmpdir(), 'chatlog-'))
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
})

describe('teeRelayUpstream', () => {
  it('builds the record from the streamed response, with no tools and no headers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlog-'))
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
    const base = mkdtempSync(join(tmpdir(), 'chatlog-'))
    writeFileSync(join(base, 'file'), '')
    const warn = vi.fn()
    const log = createChatLog(join(base, 'file', 'logs'), { warn })
    expect(() => log.write(record('2026-09-27T10:00:00.000Z'))).not.toThrow()
    log.write(record('2026-09-27T10:00:01.000Z'))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
