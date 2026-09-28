import { describe, expect, it } from 'vitest'
import { chatLogDir } from './log-dir.js'

describe('chatLogDir', () => {
  it('defaults under ~/.local/state', () => {
    expect(chatLogDir({}, '/home/u')).toBe('/home/u/.local/state/jscad-chat/logs')
  })
  it('uses XDG_STATE_HOME when set', () => {
    expect(chatLogDir({ XDG_STATE_HOME: '/state' }, '/home/u')).toBe('/state/jscad-chat/logs')
  })
  it('JSCAD_CHAT_LOG=0 turns logging off', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '0' }, '/home/u')).toBeNull()
  })
  it('JSCAD_CHAT_LOG=<dir> moves it', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '/tmp/logs', XDG_STATE_HOME: '/state' }, '/home/u')).toBe('/tmp/logs')
  })
})
