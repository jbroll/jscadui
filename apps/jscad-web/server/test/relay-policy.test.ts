import { describe, expect, it } from 'vitest'
import {
  FORWARD_HEADERS,
  RelayRefusal,
  assertPublicUpstream,
  isPrivateAddress,
  isPublicHttpsUrl,
  isTrustedRequest,
  pickForwardHeaders,
  resolveTarget,
  resolveUpstream,
} from '../src/relay/policy.js'

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.20.1.1', '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1', '127.8.9.10',
    '169.254.169.254',
    '100.64.0.1', '100.100.100.200',
    '0.0.0.0',
    '::1', '::', '[::1]',
    'fc00::1', 'fd12:3456::1',
    'fe80::1', 'febf::1', 'fe80::1%eth0',
    '::ffff:10.0.0.1', '::ffff:7f00:1', '[::ffff:192.168.0.1]',
    '64:ff9b::a00:1',
  ])('refuses %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true)
  })

  it.each([
    '8.8.8.8', '93.184.216.34',
    '172.15.0.1', '172.32.0.1',
    '100.63.0.1', '100.128.0.1',
    '11.10.0.1', '1.10.10.10',
    '2606:4700::1111', 'fec0::1', '::ffff:8.8.8.8',
    'api.10.example.com', 'my10.0host.com', 'localhost',
  ])('allows %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(false)
  })
})

describe('isPublicHttpsUrl', () => {
  it('accepts a public hostname that contains "10."', () => {
    expect(isPublicHttpsUrl('https://api10.example.com')).toBe(true)
    expect(isPublicHttpsUrl('https://v10.api.example.com/x')).toBe(true)
  })

  it('refuses literal private addresses in any spelling the URL parser normalizes', () => {
    for (const url of ['https://10.0.0.1/', 'https://172.16.0.1/', 'https://[::1]/', 'https://[fe80::1]/', 'https://0x7f.1/', 'https://2130706433/', 'https://[::ffff:127.0.0.1]/']) {
      expect(isPublicHttpsUrl(url), url).toBe(false)
    }
  })
})

describe('assertPublicUpstream', () => {
  const resolvesTo = (address: string) => async () => [{ address }]

  it('refuses a hostname that resolves to a private address', async () => {
    for (const address of ['10.0.0.5', '172.16.3.4', '192.168.0.2', '127.0.0.1', '::1', 'fd00::1', 'fe80::2']) {
      await expect(assertPublicUpstream('https://api.example.com/v1', resolvesTo(address))).rejects.toMatchObject({ status: 400 })
    }
  })

  it('allows a hostname containing "10." that resolves publicly', async () => {
    await expect(assertPublicUpstream('https://api.10.example.com/v1', resolvesTo('93.184.216.34'))).resolves.toBeUndefined()
  })

  it('refuses when any resolved address is private', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }, { address: '10.1.1.1' }]
    await expect(assertPublicUpstream('https://api.example.com', lookup)).rejects.toBeInstanceOf(RelayRefusal)
  })

  it('checks a literal IPv6 host without DNS', async () => {
    const lookup = async () => { throw new Error('no dns for literals') }
    await expect(assertPublicUpstream('https://[::1]/x', lookup)).rejects.toMatchObject({ status: 400 })
  })

  it('answers 502 when the name does not resolve', async () => {
    const lookup = async () => { throw new Error('ENOTFOUND') }
    await expect(assertPublicUpstream('https://nowhere.example', lookup)).rejects.toMatchObject({ status: 502 })
  })
})

describe('resolveUpstream', () => {
  it('joins the base and the sub-path', () => {
    expect(resolveUpstream('https://opencode.ai/zen/go/', '/v1/chat/completions')).toBe('https://opencode.ai/zen/go/v1/chat/completions')
    expect(resolveUpstream('https://api.openai.com', 'v1/models?limit=5')).toBe('https://api.openai.com/v1/models?limit=5')
  })

  it.each(['../evil', 'v1/../../x', '%2e%2e/x', '%2E%2e/x','v1\\..\\..\\x', '.%2e/x'])('refuses traversal %s', (sub) => {
    expect(() => resolveUpstream('https://opencode.ai/zen/go', sub)).toThrow(/traversal/)
  })
})

describe('resolveTarget', () => {
  const allowlist = { openai: 'https://api.openai.com' }
  const lookup = async () => [{ address: '93.184.216.34' }]

  it('404s an unknown or inherited kind', async () => {
    for (const kind of ['nope', 'constructor', '__proto__', 'toString']) {
      await expect(resolveTarget({ allowlist, kind, subPath: 'v1', dnsLookup: lookup })).rejects.toMatchObject({ status: 404 })
    }
  })

  it('skips the address check only when asked', async () => {
    const local = { test: 'http://127.0.0.1:9' }
    await expect(resolveTarget({ allowlist: local, kind: 'test', subPath: 'v1' })).rejects.toMatchObject({ status: 400 })
    await expect(resolveTarget({ allowlist: local, kind: 'test', subPath: 'v1', allowPrivate: true })).resolves.toBe('http://127.0.0.1:9/v1')
  })
})

describe('headers and origin', () => {
  it('forwards exactly the provider headers', () => {
    const headers: Record<string, string> = { cookie: 'c', origin: 'o', referer: 'r', 'x-forwarded-for': 'f', 'x-jscad-chat-id': 'id', 'user-agent': 'ua' }
    for (const name of FORWARD_HEADERS) headers[name] = `v-${name}`
    expect(Object.keys(pickForwardHeaders(headers)).sort()).toEqual([...FORWARD_HEADERS].sort())
  })

  it('trusts a listed Origin, or no Origin with Sec-Fetch-Site same-origin', () => {
    const trusted = new Set(['https://app.test'])
    expect(isTrustedRequest({ origin: 'https://app.test' }, trusted)).toBe(true)
    expect(isTrustedRequest({ origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' }, trusted)).toBe(false)
    expect(isTrustedRequest({ 'sec-fetch-site': 'same-origin' }, trusted)).toBe(true)
    expect(isTrustedRequest({ 'sec-fetch-site': 'cross-site' }, trusted)).toBe(false)
    expect(isTrustedRequest({}, trusted)).toBe(false)
  })
})
