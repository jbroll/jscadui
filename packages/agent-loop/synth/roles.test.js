import { describe, expect, it } from 'vitest'
import { FREE_MODELS, ROLES, SIM_USER_MAX_TOKENS, assertFree, pickSimUser } from './roles.js'

const probed = { 'beam-free': { available: true }, 'iceman-contributor-free': { available: false } }

describe('assertFree', () => {
  it('throws for a paid model', () => {
    expect(() => assertFree(['deepseek-v4.1-flash'], probed)).toThrow(
      'refusing to start: deepseek-v4.1-flash is not a confirmed free model',
    )
  })
  it('throws for a free model the probe marked unavailable', () => {
    expect(() => assertFree(['iceman-contributor-free'], probed)).toThrow(/iceman-contributor-free/)
  })
  it('passes for probed free models', () => {
    expect(() => assertFree(['beam-free'], probed)).not.toThrow()
  })
})

describe('ROLES', () => {
  it('uses the builder as its own simulated user only as the last fallback', () => {
    for (const r of ROLES) {
      expect(r.simUsers[0]).not.toBe(r.builder)
      expect(r.simUsers.slice(0, -1)).not.toContain(r.builder)
    }
  })
  it('uses only free models, each simulated user with a token cap', () => {
    for (const r of ROLES) {
      expect(FREE_MODELS).toEqual(expect.arrayContaining([r.builder, ...r.simUsers]))
      for (const u of r.simUsers) expect(SIM_USER_MAX_TOKENS[u]).toBeGreaterThan(0)
    }
  })
})

describe('pickSimUser', () => {
  const role = { builder: 'a-free', simUsers: ['b-free', 'beam-free'] }
  it('takes the first available simulated user', () => {
    const probe = { 'b-free': { available: true }, 'beam-free': { available: true } }
    expect(pickSimUser(role, probe)).toBe('b-free')
  })
  it('falls back when the first is unavailable', () => {
    const probe = { 'b-free': { available: false }, 'beam-free': { available: true } }
    expect(pickSimUser(role, probe)).toBe('beam-free')
  })
  it('is null when none is available', () => {
    expect(pickSimUser(role, {})).toBeNull()
  })
})
