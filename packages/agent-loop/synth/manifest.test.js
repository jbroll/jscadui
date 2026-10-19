import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addSession, createManifest, sessionEntry, writeManifest } from './manifest.js'

const result = {
  userTurns: 3,
  accepted: false,
  timedOut: false,
  error: null,
  checks: { passed: 3, total: 4, failed: ['long'] },
  simUserCalls: [{ ms: 10, inputTokens: 20, outputTokens: 5 }],
  views: [{ turn: 1, name: 'top', dataUrl: 'data:image/png;base64,AAA' }],
}
const entry = () =>
  sessionEntry({
    chatId: 'c1',
    scenario: 'jeep-1-10',
    builder: 'beam-free',
    simUser: 'minimax-m3.1-flash-free',
    run: 1,
    rounds: 7,
    result,
    stumbles: { failedCalls: 5, unbuiltTurns: 0 },
  })

let dir
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

describe('manifest', () => {
  it('sessionEntry counts corrections as sim-user turns after the opening', () => {
    expect(entry().stumbles).toEqual({ failedCalls: 5, unbuiltTurns: 0, corrections: 2 })
  })

  it('sessionEntry holds the spec fields plus rounds, timedOut and error, and no images', () => {
    expect(entry()).toEqual({
      chatId: 'c1',
      scenario: 'jeep-1-10',
      builder: 'beam-free',
      simUser: 'minimax-m3.1-flash-free',
      run: 1,
      userTurns: 3,
      accepted: false,
      checks: { passed: 3, total: 4, failed: ['long'] },
      stumbles: { failedCalls: 5, unbuiltTurns: 0, corrections: 2 },
      simUserCalls: [{ ms: 10, inputTokens: 20, outputTokens: 5 }],
      rounds: 7,
      timedOut: false,
      error: null,
    })
  })

  it('a session that never sent counts no corrections', () => {
    const e = sessionEntry({ ...entry(), result: { ...result, userTurns: 0 }, stumbles: null })
    expect(e.stumbles).toEqual({ failedCalls: null, unbuiltTurns: null, corrections: 0 })
  })

  it('writeManifest leaves valid JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-'))
    const m = createManifest({
      batch: '2026-10-19T12:00:00Z',
      jscaduiCommit: 'abc',
      scenarioSetCommit: 'def',
      probe: { 'beam-free': { available: true, vision: false } },
    })
    addSession(m, entry())
    writeManifest(dir, m)
    addSession(m, entry())
    writeManifest(dir, m)
    const read = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(read).toMatchObject({ batch: '2026-10-19T12:00:00Z', jscaduiCommit: 'abc', scenarioSetCommit: 'def' })
    expect(read.probe).toEqual({ 'beam-free': { available: true, vision: false } })
    expect(read.sessions).toHaveLength(2)
    expect(readdirSync(dir)).toEqual(['manifest.json'])
  })
})
