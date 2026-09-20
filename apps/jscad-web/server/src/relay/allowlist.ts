import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'

// Literal-IP ranges refused at load; hostnames are resolved and re-checked at
// forward time, since DNS can change between load and request.
const PRIVATE_V4 = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./, /^169\.254\./, /^0\./]
const PRIVATE_V6 = [/^::1$/, /^fc/i, /^fd/i, /^fe8/i, /^fe9/i, /^fea/i, /^feb/i]

const isLiteralPrivate = (host: string): boolean => {
  if (!isIP(host)) return false
  if (host.includes(':')) return PRIVATE_V6.some((re) => re.test(host))
  return PRIVATE_V4.some((re) => re.test(host))
}

// Names the failing check so a rejected allowlist entry says why.
const rejectReason = (value: unknown): string => {
  if (typeof value !== 'string') return 'not a string'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'not a URL'
  }
  if (parsed.protocol !== 'https:') return 'not https'
  if (parsed.port !== '') return 'explicit port'
  if (isLiteralPrivate(parsed.hostname)) return 'private or loopback address'
  return 'rejected'
}

export const isPublicHttpsUrl = (url: string): boolean => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.port !== '') return false
  if (isLiteralPrivate(parsed.hostname)) return false
  return true
}

export const loadAllowlistFile = (path: string): Record<string, string> => {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(`relay: cannot read allowlist ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`relay: allowlist ${path} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`relay: allowlist ${path} must be a {name: url} object`)
  }
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !isPublicHttpsUrl(value)) {
      throw new Error(`relay: allowlist entry '${name}' must be a public https: URL without a port (${rejectReason(value)})`)
    }
    out[name] = value
  }
  return out
}

// Joins an allowlisted base with a relay sub-path; `..` segments escape the
// upstream base, so they are rejected instead of normalized.
export const resolveUpstream = (base: string, subPath: string): string => {
  const clean = subPath.replace(/^\/+/, '')
  if (clean.split('/').includes('..')) throw new Error('relay: path traversal refused')
  return `${base.replace(/\/+$/, '')}/${clean}`
}
