import { describe, it, expect } from 'vitest'
import { hasSaveHandle, missingSaveHandleMessage } from './saveFile.js'

describe('save fallback feedback', () => {
  it('detects a missing save handle', () => {
    expect(hasSaveHandle(undefined)).toBe(false)
    expect(hasSaveHandle(null)).toBe(false)
    expect(hasSaveHandle({})).toBe(true)
  })

  it('names the file the browser could not save', () => {
    expect(missingSaveHandleMessage('main.js')).toContain('main.js')
  })
})
