import { describe, expect, it, vi } from 'vitest'
import { genParams } from './params.js'

const render = (params) => {
  const target = { innerHTML: '', querySelectorAll: () => [] }
  // genParams reports types it has no renderer for; keep the test output clean.
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    genParams({ params, target, callback: () => {}, startAnim: () => {} })
  } finally {
    log.mockRestore()
  }
  return target.innerHTML
}

describe('genParams', () => {
  it('escapes a parameter type written into the input type attribute', () => {
    const type = 'text"><img src=x onerror=alert(1)>'
    const html = render([{ type, name: 'n' }])
    expect(html).not.toContain('<img')
    expect(html).toContain('type="text&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"')
  })
})
