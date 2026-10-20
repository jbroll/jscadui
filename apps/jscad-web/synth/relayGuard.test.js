import { describe, expect, it } from 'vitest'
import { offBuilderModel } from './relayGuard.js'

const body = (o) => JSON.stringify(o)

describe('offBuilderModel', () => {
  it('passes a request for the builder', () => {
    expect(offBuilderModel(body({ model: 'beam-free', messages: [] }), 'beam-free')).toBe(null)
  })

  it('names another model', () => {
    expect(offBuilderModel(body({ model: 'claude-opus-4-1' }), 'beam-free')).toBe('claude-opus-4-1')
  })

  it('flags a body with no model', () => {
    expect(offBuilderModel(body({ messages: [] }), 'beam-free')).toBe('no model')
  })

  it('flags a body that is not JSON', () => {
    expect(offBuilderModel('not json', 'beam-free')).toBe('no model')
    expect(offBuilderModel(null, 'beam-free')).toBe('no model')
  })
})
