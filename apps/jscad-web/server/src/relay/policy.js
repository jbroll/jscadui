// Relay policy shared by the production relay (routes.ts) and the jscad-chat
// launcher (scripts/local/relay.js). Plain JS with JSDoc and node: imports only,
// so plain `node` loads it and tsc (allowJs) type-checks and emits it into dist/.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Default allowlist; mirrors PROVIDER_BASE_URLS in packages/agent-loop/src/providers.js.
/** @type {Readonly<Record<string, string>>} */
export const PROVIDER_BASE_URLS = Object.freeze({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
  meta: 'https://api.meta.ai',
})

// The app shares the relay's origin, so the browser attaches its session
// cookie; anything a provider does not need stays here.
export const FORWARD_HEADERS = Object.freeze([
  'content-type',
  'accept',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'x-opencode-session',
])

export const RATE_PER_MIN = 60

/** A refusal carries the HTTP status the adapter answers with. */
export class RelayRefusal extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {Record<string, string>}
 */
export const pickForwardHeaders = (headers) => {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (FORWARD_HEADERS.includes(key) && typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * Browsers omit Origin on a same-origin GET, so the model list from the app's
 * own origin arrives with only Sec-Fetch-Site to vouch for it.
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {ReadonlySet<string>} trusted
 */
export const isTrustedRequest = (headers, trusted) => {
  const origin = headers.origin
  if (origin !== undefined) return typeof origin === 'string' && trusted.has(origin)
  return headers['sec-fetch-site'] === 'same-origin'
}

/** @param {string} s dotted quad, already validated by isIP */
const v4Octets = (s) => s.split('.').map(Number)

/** @param {number[]} octets */
const isPrivateV4 = (octets) => {
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

/**
 * @param {string} s IPv6 text, already validated by isIP
 * @returns {number[]} eight 16-bit groups
 */
const v6Groups = (s) => {
  let text = s.toLowerCase()
  const tail = text.slice(text.lastIndexOf(':') + 1)
  if (tail.includes('.')) {
    const [a, b, c, d] = v4Octets(tail)
    text = `${text.slice(0, text.length - tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, rest] = text.split('::')
  const left = head ? head.split(':') : []
  const right = rest ? rest.split(':') : []
  const zeros = rest === undefined ? [] : Array(8 - left.length - right.length).fill('0')
  return [...left, ...zeros, ...right].map((g) => parseInt(g, 16))
}

/** @param {number[]} g */
const embeddedV4 = (g) => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]

/** @param {number[]} g */
const isPrivateV6 = (g) => {
  const zeroTo = (/** @type {number} */ n) => g.slice(0, n).every((x) => x === 0)
  if (zeroTo(7) && g[7] <= 1) return true // :: and ::1
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateV4(embeddedV4(g)) // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embeddedV4(g)) // NAT64
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80
}

/** @param {string} host URL hostname or bare address; IPv6 may be bracketed */
const bareHost = (host) => host.replace(/^\[(.*)\]$/, '$1').split('%')[0]

/**
 * True for a loopback, private, link-local, CGNAT or unspecified IP literal;
 * false for anything that is not an IP literal.
 * @param {string} addr
 */
export const isPrivateAddress = (addr) => {
  const host = bareHost(addr)
  const kind = isIP(host)
  if (kind === 4) return isPrivateV4(v4Octets(host))
  if (kind === 6) return isPrivateV6(v6Groups(host))
  return false
}

/**
 * @param {unknown} value
 * @returns {string | null} why the value is not a public https URL without a port, or null when it is
 */
const urlProblem = (value) => {
  if (typeof value !== 'string') return 'not a string'
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return 'not a URL'
  }
  if (parsed.protocol !== 'https:') return 'not https'
  if (parsed.port !== '') return 'explicit port'
  if (isPrivateAddress(parsed.hostname)) return 'private or loopback address'
  return null
}

/** @param {string} url */
export const isPublicHttpsUrl = (url) => urlProblem(url) === null

/**
 * Parses an allowlist file's text. Hostnames pass here and are resolved and
 * re-checked at forward time, since DNS can change between load and request.
 * @param {string} raw
 * @param {string} label names the file in errors
 * @returns {Record<string, string>}
 */
export const parseAllowlist = (raw, label) => {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`relay: allowlist ${label} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`relay: allowlist ${label} must be a {name: url} object`)
  }
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(parsed)) {
    const problem = urlProblem(value)
    if (problem !== null) {
      throw new Error(`relay: allowlist entry '${name}' must be a public https: URL without a port (${problem})`)
    }
    out[name] = /** @type {string} */ (value)
  }
  return out
}

/**
 * Joins an allowlisted base with a relay sub-path. `..` segments, including
 * the %2e%2e and backslash forms the URL parser also resolves, would escape
 * the base, so they are refused rather than normalized.
 * @param {string} base
 * @param {string} subPath
 */
export const resolveUpstream = (base, subPath) => {
  const clean = subPath.replace(/^\/+/, '')
  const root = base.replace(/\/+$/, '')
  const joined = `${root}/${clean}`
  const baseUrl = new URL(root)
  const url = new URL(joined)
  const prefix = `${baseUrl.pathname.replace(/\/+$/, '')}/`
  if (clean.split('/').includes('..') || url.origin !== baseUrl.origin || !url.pathname.startsWith(prefix)) {
    throw new RelayRefusal(400, 'relay: path traversal refused')
  }
  return joined
}

/** @typedef {(host: string) => Promise<Array<{ address: string }>>} DnsLookup */

/** @type {DnsLookup} */
const systemLookup = (host) => lookup(host, { all: true })

/**
 * Resolves the upstream host at forward time; a permitted name could
 * otherwise have been pointed at a private address after the allowlist loaded.
 * @param {string} url
 * @param {DnsLookup} [dnsLookup]
 */
export const assertPublicUpstream = async (url, dnsLookup = systemLookup) => {
  const host = bareHost(new URL(url).hostname)
  let addresses
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = (await dnsLookup(host)).map((r) => r.address)
    } catch {
      throw new RelayRefusal(502, 'upstream unreachable')
    }
  }
  if (addresses.some(isPrivateAddress)) throw new RelayRefusal(400, 'relay: upstream resolves to a private address')
}

/**
 * Everything between the origin/rate gates and the fetch: provider lookup,
 * sub-path join, private-address check. Throws RelayRefusal.
 * @param {{ allowlist: Record<string, string>, kind: string, subPath: string, dnsLookup?: DnsLookup, allowPrivate?: boolean }} options
 * @returns {Promise<string>} the upstream URL
 */
export const resolveTarget = async ({ allowlist, kind, subPath, dnsLookup, allowPrivate = false }) => {
  const base = Object.hasOwn(allowlist, kind) ? allowlist[kind] : undefined
  if (typeof base !== 'string') throw new RelayRefusal(404, 'unknown provider')
  let upstream
  try {
    upstream = resolveUpstream(base, subPath)
  } catch (err) {
    if (err instanceof RelayRefusal) throw err
    throw new RelayRefusal(400, 'relay: bad upstream URL')
  }
  if (!allowPrivate) await assertPublicUpstream(upstream, dnsLookup)
  return upstream
}

/** @typedef {{ ok: true } | { ok: false, retryAfterSec: number }} LimitResult */

/**
 * Per-key token bucket. Refill is lazy on check; idle buckets stay in the map
 * (relay traffic is low-cardinality client IPs, so no eviction is needed).
 * @param {{ ratePerMin: number, burst: number, now?: () => number }} options
 * @returns {{ check(key: string): LimitResult }}
 */
export const createLimiter = ({ ratePerMin, burst, now = Date.now }) => {
  const perMs = ratePerMin / 60_000
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map()
  return {
    check(key) {
      const t = now()
      const bucket = buckets.get(key) ?? { tokens: burst, at: t }
      const tokens = Math.min(burst, bucket.tokens + (t - bucket.at) * perMs)
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: t })
        return { ok: true }
      }
      buckets.set(key, { tokens, at: t })
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) }
    },
  }
}
