import { describe, expect, it } from 'vitest'
import { compareBatches, formatCompare } from './compare.js'

const session = (scenario, builder, over = {}) => ({
  chatId: `${scenario}-${builder}`,
  scenario,
  builder,
  simUser: 'u',
  run: 1,
  userTurns: 1,
  accepted: true,
  checks: { passed: 2, total: 2, failed: [] },
  stumbles: { failedCalls: 0, unbuiltTurns: 0, corrections: 0 },
  simUserCalls: [],
  rounds: 4,
  timedOut: false,
  error: null,
  ...over,
})
const batch = (sessions) => ({ batch: 'b', sessions })

describe('compareBatches', () => {
  it('pairs rows by scenario and builder', () => {
    const a = batch([
      session('jeep', 'beam-free'),
      session('jeep', 'beam-free', {
        run: 2,
        userTurns: 3,
        accepted: false,
        checks: { passed: 0, total: null, failed: [], noGeometry: true },
        stumbles: { failedCalls: 4, unbuiltTurns: 2, corrections: 2 },
        rounds: 10,
      }),
      session('gear', 'beam-free'),
    ])
    const b = batch([session('gear', 'beam-free'), session('jeep', 'beam-free', { checks: { passed: 1, total: 2, failed: ['long'] } })])
    const rows = compareBatches(a, b)
    expect(rows.map((r) => `${r.scenario}|${r.builder}`)).toEqual(['jeep|beam-free', 'gear|beam-free'])
    expect(rows[0].a).toEqual({
      sessions: 2,
      errors: 0,
      timedOut: 0,
      checkPassRate: 0.5,
      accepted: 1,
      meanUserTurns: 2,
      meanRounds: 7,
      meanFailedCalls: 2,
      meanUnbuiltTurns: 1,
      meanCorrections: 1,
    })
    expect(rows[0].b).toMatchObject({ sessions: 1, checkPassRate: 0.5, accepted: 1 })
  })

  it('a row missing from one batch shows null stats', () => {
    const rows = compareBatches(batch([session('jeep', 'beam-free')]), batch([session('gear', 'beam-free')]))
    expect(rows).toHaveLength(2)
    expect(rows[0].b).toBe(null)
    expect(rows[1].a).toBe(null)
  })

  it('ignores skipped entries', () => {
    const rows = compareBatches(batch([{ builder: 'beam-free', skipped: true, reason: 'probe failed' }, session('jeep', 'beam-free')]), batch([]))
    expect(rows).toHaveLength(1)
    expect(rows[0].a.sessions).toBe(1)
  })

  it('scenarios without checks have a null pass rate', () => {
    const rows = compareBatches(batch([session('jeep', 'beam-free', { checks: null })]), batch([]))
    expect(rows[0].a.checkPassRate).toBe(null)
  })

  it('leaves errored sessions out of the means and counts them', () => {
    const a = batch([
      session('jeep', 'beam-free'),
      session('jeep', 'beam-free', { run: 2, error: 'page crashed', checks: null, userTurns: 1, rounds: 1, accepted: false }),
      session('jeep', 'beam-free', { run: 3, timedOut: true, accepted: false, userTurns: 1, rounds: 32, checks: { passed: 0, total: 2, failed: ['a', 'b'] } }),
    ])
    const [row] = compareBatches(a, batch([]))
    expect(row.a).toMatchObject({ sessions: 3, errors: 1, timedOut: 1, checkPassRate: 0.5, accepted: 1, meanRounds: 18 })
  })

  it('a row of only errored sessions has null means', () => {
    const [row] = compareBatches(batch([session('jeep', 'beam-free', { error: 'go 429', checks: null })]), batch([]))
    expect(row.a).toMatchObject({ sessions: 1, errors: 1, checkPassRate: null, accepted: 0, meanUserTurns: null })
  })

  it('formats one line per row, with - for the missing side', () => {
    const text = formatCompare(compareBatches(batch([session('jeep', 'beam-free')]), batch([])))
    const [header, line] = text.split('\n')
    expect(header.split(/\s{2,}/)).toEqual(['scenario', 'builder', 'n', 'errors', 'timeouts', 'checks', 'accepted', 'turns', 'rounds', 'failed', 'unbuilt', 'corrections'])
    expect(line.split(/\s{2,}/)).toEqual(['jeep', 'beam-free', '1 -> -', '0 -> -', '0 -> -', '1 -> -', '1 -> -', '1 -> -', '4 -> -', '0 -> -', '0 -> -', '0 -> -'])
  })
})
