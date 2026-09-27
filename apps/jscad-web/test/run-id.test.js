import { describe, it, expect } from 'vitest'
import { newRunId } from '../src/runId.js'

describe('newRunId', () => {
  it('mints ids model code cannot guess', () => {
    const ids = Array.from({ length: 10 }, () => newRunId())
    for (const id of ids) {
      // A sequential integer runId is brute-forceable by model code posting
      // jscadCells or jscadClaim; ids must not be plain numbers.
      expect(typeof id).toBe('string')
      expect(id).not.toMatch(/^\d+$/)
    }
  })

  it('mints a unique id per run', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId()))
    expect(ids.size).toBe(1000)
  })
})
