// Pure helpers that shape version rows: the editor coalesce window, the chat
// excerpt that names a turn, and the file-map equality used to skip a row when
// nothing changed.
import { describe, expect, it } from 'vitest'
import { EDIT_COALESCE_MS, chatVersionMessage, excerptOf, sameFiles } from '../src/storage/versioning.js'

describe('versioning helpers', () => {
  it('collapses whitespace and trims the excerpt', () => {
    expect(excerptOf('  exhaust\npipes   at the rear  ')).toBe('exhaust pipes at the rear')
  })

  it('caps the excerpt at 60 characters by default', () => {
    expect(excerptOf('x'.repeat(100))).toHaveLength(60)
    expect(excerptOf('y'.repeat(100), 10)).toBe('y'.repeat(10))
  })

  it('prefixes the chat message with the excerpt', () => {
    expect(chatVersionMessage('exhaust pipes')).toBe('chat: exhaust pipes')
  })

  it('falls back to a bare chat message without an excerpt', () => {
    expect(chatVersionMessage('')).toBe('chat')
  })

  it('compares file maps by key set and content', () => {
    expect(sameFiles({ 'a.js': '1' }, { 'a.js': '1' })).toBe(true)
    expect(sameFiles({ 'a.js': '1' }, { 'a.js': '2' })).toBe(false)
    expect(sameFiles({ 'a.js': '1' }, { 'a.js': '1', 'b.js': '2' })).toBe(false)
  })

  it('exposes a five-minute editor coalesce window', () => {
    expect(EDIT_COALESCE_MS).toBe(300000)
  })
})
