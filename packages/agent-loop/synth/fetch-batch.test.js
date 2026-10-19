import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fetchBatch } from './fetch-batch.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80])

const fakeSci = (files) => ({
  run: (_sci, args) => {
    const content = files[args[2]]
    if (content === undefined) throw new Error(`no artifact ${args[2]}`)
    return content.toString('utf8')
  },
  runBytes: (_sci, args) => {
    const content = files[args[2]]
    if (content === undefined) throw new Error(`no artifact ${args[2]}`)
    return Buffer.from(content)
  },
})

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetch-batch-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('fetchBatch', () => {
  it('copies every listed file into the batch dir', () => {
    const files = {
      'synth-results/latest': 'b1\n',
      'synth-results/b1/index.txt': 'manifest.json\nchats/a.jsonl\n',
      'synth-results/b1/manifest.json': '{"sessions":[]}',
      'synth-results/b1/chats/a.jsonl': '{"x":1}\n',
    }
    const out = fetchBatch('JOB-1', { sci: 'sci', logDir: dir, ...fakeSci(files) })
    expect(out.batch).toBe('b1')
    expect(out.files).toEqual(['manifest.json', 'chats/a.jsonl'])
    expect(readFileSync(join(dir, 'synthetic/b1/manifest.json'), 'utf8')).toBe('{"sessions":[]}')
    expect(readFileSync(join(dir, 'synthetic/b1/chats/a.jsonl'), 'utf8')).toBe('{"x":1}\n')
  })

  it('rejects a listed path with ..', () => {
    const files = {
      'synth-results/latest': 'b1\n',
      'synth-results/b1/index.txt': 'ok.txt\n../evil.txt\n',
      'synth-results/b1/ok.txt': 'ok',
    }
    expect(() => fetchBatch('JOB-1', { sci: 'sci', logDir: dir, ...fakeSci(files) })).toThrow(/\.\./)
  })

  it('writes PNGs byte for byte', () => {
    const files = {
      'synth-results/latest': 'b1\n',
      'synth-results/b1/index.txt': 'shots/a.png\n',
      'synth-results/b1/shots/a.png': PNG,
    }
    fetchBatch('JOB-1', { sci: 'sci', logDir: dir, ...fakeSci(files) })
    expect(readFileSync(join(dir, 'synthetic/b1/shots/a.png')).equals(PNG)).toBe(true)
  })
})
