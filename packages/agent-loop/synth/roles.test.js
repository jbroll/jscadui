import { describe, expect, it } from 'vitest'
import { FREE_MODELS, ROLES, SIM_USER_MAX_TOKENS, assertFree, pickSimUser } from './roles.js'

const probed = { 'beam-free': { available: true }, 'minimax-m3.1-flash-free': { available: false } }

describe('assertFree', () => {
  it('throws for a paid model', () => {
    expect(() => assertFree(['deepseek-v4.1-flash'], probed)).toThrow(
      'refusing to start: deepseek-v4.1-flash is not a confirmed free model',
    )
  })
  it('throws for a free model the probe marked unavailable', () => {
    expect(() => assertFree(['minimax-m3.1-flash-free'], probed)).toThrow(/minimax-m3.1-flash-free/)
  })
  it('passes for probed free models', () => {
    expect(() => assertFree(['beam-free'], probed)).not.toThrow()
  })
})

describe('ROLES', () => {
  it('never uses the builder as its own simulated user', () => {
    for (const r of ROLES) expect(r.simUsers).not.toContain(r.builder)
  })
  it('uses only free models, each simulated user with a token cap', () => {
    for (const r of ROLES) {
      expect(FREE_MODELS).toEqual(expect.arrayContaining([r.builder, ...r.simUsers]))
      for (const u of r.simUsers) expect(SIM_USER_MAX_TOKENS[u]).toBeGreaterThan(0)
    }
  })
})

describe('pickSimUser', () => {
  const role = { builder: 'minimax-m3.1-flash-free', simUsers: ['longcat-2.5-preview-free', 'beam-free'] }
  it('takes the first available simulated user', () => {
    const probe = { 'longcat-2.5-preview-free': { available: true }, 'beam-free': { available: true } }
    expect(pickSimUser(role, probe)).toBe('longcat-2.5-preview-free')
  })
  it('falls back when the first is unavailable', () => {
    const probe = { 'longcat-2.5-preview-free': { available: false }, 'beam-free': { available: true } }
    expect(pickSimUser(role, probe)).toBe('beam-free')
  })
  it('is null when none is available', () => {
    expect(pickSimUser(role, {})).toBeNull()
  })
})
