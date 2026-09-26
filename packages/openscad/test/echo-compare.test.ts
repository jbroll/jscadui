import { describe, it, expect } from 'vitest'
import { parseEchoExport, compareEcho, describeEchoMismatch } from '../bin/echo-compare.js'

describe('parseEchoExport', () => {
  it('keeps ECHO messages only', () => {
    const text = 'ECHO: 1\nWARNING: Ignoring unknown variable "f"\nECHO: "a", b = 2\n'
    expect(parseEchoExport(text)).toEqual(['ECHO: 1', 'ECHO: "a", b = 2'])
  })

  it('rejoins an echoed string that contains newlines', () => {
    expect(parseEchoExport('ECHO: "a\nb"\nECHO: 2\n')).toEqual(['ECHO: "a\nb"', 'ECHO: 2'])
  })

  it('does not attach continuation lines of other messages to an echo', () => {
    expect(parseEchoExport('ECHO: 1\nERROR: x\nmore of the error\nECHO: 2\n')).toEqual(['ECHO: 1', 'ECHO: 2'])
  })

  it('keeps an empty echo() and an empty export', () => {
    expect(parseEchoExport('ECHO: \n')).toEqual(['ECHO: '])
    expect(parseEchoExport('')).toEqual([])
  })
})

describe('compareEcho', () => {
  it('matches equal lists', () => {
    expect(compareEcho(['ECHO: 1'], ['ECHO: 1'])).toMatchObject({ match: true, refCount: 1, genCount: 1 })
  })

  it('reports the first difference, including a missing line', () => {
    const cmp = compareEcho(['ECHO: 1', 'ECHO: 2'], ['ECHO: 1'])
    expect(cmp).toMatchObject({ match: false, index: 1, expected: 'ECHO: 2', actual: undefined })
    expect(describeEchoMismatch(cmp)).toBe('echo 2/2 (got 1): expected "ECHO: 2", got (none)')
  })
})
