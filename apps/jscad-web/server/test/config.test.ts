import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.js'

const REQUIRED = { ROWBOAT_DATABASE_ID: 'db_test', ROWBOAT_URL: 'https://rowboat.test' }
const KEYS = ['NODE_ENV', 'BETTER_AUTH_SECRET', 'FRONTEND_URL', 'ROWBOAT_DATABASE_ID', 'ROWBOAT_URL', 'RELAY_INFERENCE', 'RELAY_SHARED']
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, REQUIRED)
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('configFromEnv', () => {
  it('refuses production without BETTER_AUTH_SECRET', () => {
    process.env.NODE_ENV = 'production'
    expect(() => configFromEnv()).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('keeps the placeholder secret outside production and trusts the dev origin', () => {
    const config = configFromEnv()
    expect(config.authSecret).toBe('dev-secret-change-me')
    expect(config.trustedOrigins).toContain('http://localhost:5120')
  })

  it('drops the dev origin and keeps the real origins in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_SECRET = 'a-real-secret'
    const config = configFromEnv()
    expect(config.authSecret).toBe('a-real-secret')
    expect(config.trustedOrigins).not.toContain('http://localhost:5120')
    expect(config.trustedOrigins).toContain('https://jscad.rkroll.com')
    expect(config.trustedOrigins).toContain('https://appleid.apple.com')
  })

  it('defaults the inference file to jscad-inference.json', () => {
    expect(configFromEnv().relaySharedPath).toBe('/etc/jscad-relay/jscad-inference.json')
  })

  it('prefers RELAY_INFERENCE and accepts the deprecated RELAY_SHARED as a fallback', () => {
    process.env.RELAY_SHARED = '/x/shared.json'
    expect(configFromEnv().relaySharedPath).toBe('/x/shared.json')

    process.env.RELAY_INFERENCE = '/x/jscad-inference.json'
    expect(configFromEnv().relaySharedPath).toBe('/x/jscad-inference.json')
  })
})
