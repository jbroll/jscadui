import { describe, expect, it } from 'vitest'
import { runKeylessBaseline } from './keyless.js'

describe('keyless baseline', () => {
  it('scores full marks on every fixture with real geometry', async () => {
    const results = await runKeylessBaseline()
    expect(results.map((r) => r.fixture)).toEqual(['cube-hole', 'gear', 'bracket'])
    for (const { report } of results) {
      expect(report.dimensions).toEqual({ discipline: 2, recovery: 1, geometry: 2, conservation: 2 })
      expect(report.total).toBe(7)
    }
  })
})
