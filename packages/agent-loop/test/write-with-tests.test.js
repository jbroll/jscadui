import { describe, expect, it } from 'vitest'
import { isCodePath } from '../src/project.js'
import { summarizeTestRun } from '../src/testPackage.js'
describe('isCodePath', () => {
  it('skips notes and includes js', () => {
    expect(isCodePath('notes/a.md')).toBe(false)
    expect(isCodePath('main.js')).toBe(true)
  })

  it('skips test files, docs and notes js, includes helpers', () => {
    expect(isCodePath('test/a.js')).toBe(false)
    expect(isCodePath('notes/plan.js')).toBe(false)
    expect(isCodePath('README.md')).toBe(false)
    expect(isCodePath('notes.md')).toBe(false)
    expect(isCodePath('lib/helper.js')).toBe(true)
    expect(isCodePath('test.js')).toBe(true)
    expect(isCodePath(undefined)).toBe(false)
  })
})

describe('summarizeTestRun', () => {
  it('marks parts with zero passing asserts uncovered', () => {
    const { tests, coverageNote } = summarizeTestRun(
      { ok: true, passed: 2, failed: 0, failures: [], assertsByPart: { 0: 2 }, files: ['test/a.js'] },
      2,
    )
    expect(tests).toEqual({ ok: true, passed: 2, failed: 0, assertsByPart: { 0: 2 }, uncovered: [1] })
    expect(coverageNote).toContain('uncovered parts: [1]')
  })

  it('leaves every known part uncovered when no tests ran', () => {
    const { tests, coverageNote } = summarizeTestRun({ ok: true, passed: 0, failed: 0, failures: [], assertsByPart: {}, files: [] }, 1)
    expect(tests.uncovered).toEqual([0])
    expect(coverageNote).toContain('no test files in test/')
  })

  it('leaves uncovered empty without geometry and names the failures', () => {
    const { tests, coverageNote } = summarizeTestRun(
      {
        ok: false,
        passed: 0,
        failed: 1,
        failures: [{ file: 'test/a.js', test: 'x', error: { name: 'AssertionError', message: 'boom', line: 2 } }],
        assertsByPart: {},
        files: ['test/a.js'],
      },
      undefined,
    )
    expect(tests.uncovered).toEqual([])
    expect(coverageNote).toContain('part coverage is unknown')
    expect(coverageNote).toContain(`test/a.js 'x'`)
    expect(coverageNote).toContain('boom')
  })
})
