import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatLog, toLogRequest } from './chatLog.js'

const record = (ts) => ({ ts, chatId: 'c', kind: 'openai', path: 'v1/chat/completions', status: 200, request: {}, response: 'x', ms: 1 })

describe('chat log', () => {
  it('appends one JSON line per record to a file named by the UTC date, creating the dir', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'chatlog-')), 'logs')
    const log = createChatLog(dir)
    log.write(record('2026-09-27T10:00:00.000Z'))
    log.write(record('2026-09-27T11:00:00.000Z'))
    const lines = readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).ts)).toEqual(['2026-09-27T10:00:00.000Z', '2026-09-27T11:00:00.000Z'])
  })

  it('warns once and never throws when the dir cannot be created', () => {
    const base = mkdtempSync(join(tmpdir(), 'chatlog-'))
    writeFileSync(join(base, 'file'), '')
    const warn = vi.fn()
    const log = createChatLog(join(base, 'file', 'logs'), { warn })
    expect(() => log.write(record('2026-09-27T10:00:00.000Z'))).not.toThrow()
    log.write(record('2026-09-27T10:00:01.000Z'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('drops tools from a JSON body and keeps an unparseable body as text', () => {
    expect(toLogRequest(Buffer.from(JSON.stringify({ model: 'm', tools: [{ name: 'eval' }] })))).toEqual({ model: 'm' })
    expect(toLogRequest(Buffer.from('not json'))).toBe('not json')
  })
})
