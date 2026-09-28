import { describe, expect, it } from 'vitest'
import { formatRunHeader, formatText, formatToolCall, formatToolResult } from './verbose.js'

describe('formatRunHeader', () => {
  it('prints the fixture, run count and prompt', () => {
    expect(formatRunHeader({ name: 'cube', prompt: 'make a cube' }, 2, 5)).toBe(
      '== cube run 2/5\nuser: make a cube',
    )
  })
})

describe('formatText', () => {
  it('prints the full assistant text unclipped', () => {
    const text = 'x'.repeat(500)
    expect(formatText(text)).toBe(`assistant: ${text}`)
  })
})

describe('formatToolCall', () => {
  it('indents a source input by four spaces, in full', () => {
    expect(formatToolCall('eval', { source: 'line one\nline two' })).toBe(
      '→ eval\n    line one\n    line two',
    )
  })

  it('prints other inputs as compact JSON on the same line', () => {
    expect(formatToolCall('measure', { axis: 'z' })).toBe('→ measure {"axis":"z"}')
  })

  it('prints just the tool name when input is empty', () => {
    expect(formatToolCall('measure', {})).toBe('→ measure')
  })
})

describe('formatToolResult', () => {
  it('prints ok with the compact result JSON, clipped to 300 chars', () => {
    const long = JSON.stringify({ ok: true, entities: 1, blob: 'y'.repeat(400) })
    const out = formatToolResult(long)
    expect(out.startsWith('← ok ')).toBe(true)
    expect(out.length).toBe('← ok '.length + 300)
  })

  it('prints a single-line failure inline', () => {
    const result = JSON.stringify({ ok: false, error: { name: 'SyntaxError', message: 'bad token' } })
    expect(formatToolResult(result)).toBe('← FAILED SyntaxError: bad token')
  })

  it('indents a multi-line failure message by four spaces', () => {
    const result = JSON.stringify({ ok: false, error: { name: 'EvalError', message: 'line one\nline two' } })
    expect(formatToolResult(result)).toBe('← FAILED EvalError:\n    line one\n    line two')
  })
})
