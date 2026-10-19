import { describe, it, expect } from 'vitest'
import { installHarnessHook, HARNESS_FLAG_KEY } from '../src/harnessHook.js'

const storageOf = (items) => ({ getItem: (k) => items[k] ?? null })

describe('installHarnessHook', () => {
  it('installs nothing without the flag', () => {
    const target = {}
    const handlers = { view: async () => 1, measure: async () => 2, check: async () => 3, buildReport: async () => 4 }
    expect(installHarnessHook({ storage: storageOf({}), target, ...handlers })).toBe(false)
    expect(target.jscadHarness).toBeUndefined()
  })

  it('installs the four handlers with the flag', async () => {
    const target = {}
    const handlers = {
      view: async (a) => ({ view: a }),
      measure: async (a) => ({ measure: a }),
      check: async (a) => ({ check: a }),
      buildReport: async () => ({ ok: true }),
    }
    expect(installHarnessHook({ storage: storageOf({ [HARNESS_FLAG_KEY]: '1' }), target, ...handlers })).toBe(true)
    expect(await target.jscadHarness.view({ views: ['top'] })).toEqual({ view: { views: ['top'] } })
    expect(await target.jscadHarness.measure({})).toEqual({ measure: {} })
    expect(await target.jscadHarness.check({})).toEqual({ check: {} })
    expect(await target.jscadHarness.buildReport()).toEqual({ ok: true })
  })
})
