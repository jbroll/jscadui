import { describe, expect, it } from 'vitest'
import { FREE_MODELS, ROLES, assertFree } from './roles.js'

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
    for (const r of ROLES) expect(r.simUser).not.toBe(r.builder)
  })
  it('uses only free models', () => {
    for (const r of ROLES) expect(FREE_MODELS).toEqual(expect.arrayContaining([r.builder, r.simUser]))
  })
})
