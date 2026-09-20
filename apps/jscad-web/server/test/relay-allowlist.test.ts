import { describe, expect, it } from 'vitest'
import { isPublicHttpsUrl, loadAllowlistFile, resolveUpstream } from '../src/relay/allowlist.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), `relay-test-${process.pid}`)
mkdirSync(dir, { recursive: true })
const file = (name: string, body: string) => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('allowlist', () => {
  it('loads a valid file', () => {
    const p = file('ok.json', JSON.stringify({ anthropic: 'https://api.anthropic.com' }))
    expect(loadAllowlistFile(p)).toEqual({ anthropic: 'https://api.anthropic.com' })
  })

  it('rejects http, ports, and literal private IPs', () => {
    expect(() => loadAllowlistFile(file('a.json', JSON.stringify({ x: 'http://api.anthropic.com' })))).toThrow(/https/)
    expect(() => loadAllowlistFile(file('b.json', JSON.stringify({ x: 'https://api.anthropic.com:8443' })))).toThrow(/port/)
    expect(() => loadAllowlistFile(file('c.json', JSON.stringify({ x: 'https://127.0.0.1/x' })))).toThrow(/private|loopback/)
    expect(() => loadAllowlistFile(file('d.json', 'not json'))).toThrow(/JSON|parse/)
    expect(() => loadAllowlistFile(join(dir, 'missing.json'))).toThrow(/read|ENOENT/)
  })

  it('joins sub-paths and refuses traversal', () => {
    expect(resolveUpstream('https://api.anthropic.com', 'v1/messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(() => resolveUpstream('https://api.anthropic.com', '../evil')).toThrow(/traversal/)
  })

  it('classifies public https URLs', () => {
    expect(isPublicHttpsUrl('https://api.anthropic.com')).toBe(true)
    expect(isPublicHttpsUrl('http://api.anthropic.com')).toBe(false)
    expect(isPublicHttpsUrl('https://10.0.0.1/')).toBe(false)
  })
})
