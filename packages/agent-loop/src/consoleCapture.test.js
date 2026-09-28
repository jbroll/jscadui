import { describe, expect, it } from 'vitest'
import { CONSOLE_CAP_CHARS, CONSOLE_CAP_LINES, createConsoleCollector, formatConsoleArgs, installConsoleCapture } from './consoleCapture.js'

describe('formatConsoleArgs', () => {
  it('joins strings as-is', () => {
    expect(formatConsoleArgs(['a', 'b'])).toBe('a b')
  })

  it('JSON.stringifies objects and arrays', () => {
    expect(formatConsoleArgs([{ x: 1 }, [1, 2]])).toBe('{"x":1} [1,2]')
  })

  it('falls back to String on a circular object', () => {
    const circular = {}
    circular.self = circular
    expect(formatConsoleArgs([circular])).toBe(String(circular))
  })

  it('stringifies primitives without quoting', () => {
    expect(formatConsoleArgs([1, true, null, undefined])).toBe('1 true null undefined')
  })
})

describe('createConsoleCollector', () => {
  it('caps at 50 lines and appends a truncation note', () => {
    const collector = createConsoleCollector()
    for (let i = 0; i < CONSOLE_CAP_LINES + 5; i++) collector.append('x')
    const list = collector.list()
    expect(list).toHaveLength(CONSOLE_CAP_LINES + 1)
    expect(list.at(-1)).toBe('… (5 more lines)')
  })

  it('caps at 4000 characters total', () => {
    const collector = createConsoleCollector()
    collector.append('a'.repeat(CONSOLE_CAP_CHARS))
    collector.append('overflow')
    expect(collector.list()).toEqual(['a'.repeat(CONSOLE_CAP_CHARS), '… (1 more lines)'])
  })

  it('reset clears lines and the truncation count', () => {
    const collector = createConsoleCollector()
    collector.append('a')
    collector.reset()
    expect(collector.list()).toEqual([])
  })

  it('capture formats args like console.log would', () => {
    const collector = createConsoleCollector()
    collector.capture('x', { y: 1 })
    expect(collector.list()).toEqual(['x {"y":1}'])
  })
})

describe('installConsoleCapture', () => {
  it('captures console calls and restores the originals after', () => {
    const originalLog = console.log
    const capture = installConsoleCapture()
    console.log('hello', 1)
    console.warn('careful')
    capture.restore()
    expect(console.log).toBe(originalLog)
    expect(capture.list()).toEqual(['hello 1', 'careful'])
  })

  it('restores on throw when the caller wraps the run in try/finally', () => {
    const originalError = console.error
    const capture = installConsoleCapture()
    try {
      console.error('before throw')
      throw new Error('boom')
    } catch {
      // swallowed to reach the assertions below
    } finally {
      capture.restore()
    }
    expect(console.error).toBe(originalError)
    expect(capture.list()).toEqual(['before throw'])
  })

  it('forwards to the real console when asked, without losing capture', () => {
    const calls = []
    const originalLog = console.log
    console.log = (...args) => calls.push(args)
    const capture = installConsoleCapture({ forward: true })
    console.log('forwarded')
    capture.restore()
    console.log = originalLog
    expect(calls).toEqual([['forwarded']])
    expect(capture.list()).toEqual(['forwarded'])
  })

  it('does not forward by default', () => {
    const calls = []
    const originalLog = console.log
    console.log = (...args) => calls.push(args)
    const capture = installConsoleCapture()
    console.log('quiet')
    capture.restore()
    console.log = originalLog
    expect(calls).toEqual([])
    expect(capture.list()).toEqual(['quiet'])
  })
})
