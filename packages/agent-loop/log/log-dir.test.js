import { describe, expect, it } from 'vitest'
import { chatDataDir, chatLogDir, evalResultsDir } from './log-dir.js'

const exists = (yes) => () => yes

describe('chatDataDir', () => {
  it('uses JSCAD_CHAT_DATA when set', () => {
    expect(chatDataDir({ JSCAD_CHAT_DATA: '/data' }, '/home/u', exists(false))).toBe('/data')
  })
  it('falls back to ~/src/jscad-chat-evals when it exists', () => {
    expect(chatDataDir({}, '/home/u', exists(true))).toBe('/home/u/src/jscad-chat-evals')
  })
  it('is null when nothing is set and the default dir is missing', () => {
    expect(chatDataDir({}, '/home/u', exists(false))).toBeNull()
  })
})

describe('chatLogDir', () => {
  it('defaults under ~/.local/state when there is no data dir', () => {
    expect(chatLogDir({}, '/home/u', exists(false))).toBe('/home/u/.local/state/jscad-chat/logs')
  })
  it('uses XDG_STATE_HOME when set and there is no data dir', () => {
    expect(chatLogDir({ XDG_STATE_HOME: '/state' }, '/home/u', exists(false))).toBe('/state/jscad-chat/logs')
  })
  it('JSCAD_CHAT_LOG=0 turns logging off', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '0' }, '/home/u', exists(true))).toBeNull()
  })
  it('JSCAD_CHAT_LOG=<dir> moves it', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '/tmp/logs', XDG_STATE_HOME: '/state' }, '/home/u', exists(true))).toBe('/tmp/logs')
  })
  it('uses <data>/logs when the evals repo exists', () => {
    expect(chatLogDir({}, '/home/u', exists(true))).toBe('/home/u/src/jscad-chat-evals/logs')
  })
  it('JSCAD_CHAT_DATA overrides the default data dir', () => {
    expect(chatLogDir({ JSCAD_CHAT_DATA: '/data' }, '/home/u', exists(false))).toBe('/data/logs')
  })
})

describe('evalResultsDir', () => {
  it('uses EVAL_RESULTS_DIR when set', () => {
    expect(evalResultsDir({ EVAL_RESULTS_DIR: '/results' }, '/home/u', exists(false))).toBe('/results')
  })
  it('uses <data>/results when the evals repo exists', () => {
    expect(evalResultsDir({}, '/home/u', exists(true))).toBe('/home/u/src/jscad-chat-evals/results')
  })
  it('is null when there is no data dir and no explicit override', () => {
    expect(evalResultsDir({}, '/home/u', exists(false))).toBeNull()
  })
})
