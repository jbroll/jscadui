/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import { escapeCloses } from '../src/panelEscape.js'

const panel = (className) => {
  const el = document.createElement('div')
  el.className = className
  el.appendChild(document.createElement('button'))
  document.body.appendChild(el)
  return el
}

const escapeFrom = (target) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape' })
  Object.defineProperty(e, 'target', { value: target })
  return e
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('escapeCloses', () => {
  it('closes a panel open on its own wherever focus is', () => {
    const demo = panel('demo-panel')
    expect(escapeCloses(escapeFrom(document.body), demo, ['.parts-panel', '.api-help-panel'])).toBe(true)
  })

  it('closes only the panel that holds focus', () => {
    const demo = panel('demo-panel')
    const parts = panel('parts-panel')
    const e = escapeFrom(demo.firstChild)
    expect(escapeCloses(e, parts, ['.demo-panel', '.api-help-panel'])).toBe(false)
    expect(escapeCloses(e, demo, ['.parts-panel', '.api-help-panel'])).toBe(true)
  })

  it('closes the newer panel when focus is in neither, once per event', () => {
    const demo = panel('demo-panel')
    const parts = panel('parts-panel')
    const e = escapeFrom(document.body)
    expect(escapeCloses(e, parts, ['.demo-panel', '.api-help-panel'])).toBe(true)
    parts.remove()
    expect(escapeCloses(e, demo, ['.parts-panel', '.api-help-panel'])).toBe(false)
    expect(escapeCloses(escapeFrom(document.body), demo, ['.parts-panel', '.api-help-panel'])).toBe(true)
  })

  it('ignores other keys', () => {
    const demo = panel('demo-panel')
    expect(escapeCloses(new KeyboardEvent('keydown', { key: 'Enter' }), demo, ['.parts-panel', '.api-help-panel'])).toBe(false)
  })

  it('closes only the help panel when demo and help are open and focus is in neither', () => {
    const demo = panel('demo-panel')
    const help = panel('api-help-panel')
    const e = escapeFrom(document.body)
    expect(escapeCloses(e, demo, ['.parts-panel', '.api-help-panel'])).toBe(false)
    expect(escapeCloses(e, help, ['.demo-panel', '.parts-panel'])).toBe(true)
    // A fresh Escape, with help closed, closes the remaining panel.
    help.remove()
    expect(escapeCloses(escapeFrom(document.body), demo, ['.parts-panel', '.api-help-panel'])).toBe(true)
  })

  it('closes the focused panel even when three are open', () => {
    const demo = panel('demo-panel')
    const parts = panel('parts-panel')
    const help = panel('api-help-panel')
    const e = escapeFrom(help.firstChild)
    expect(escapeCloses(e, demo, ['.parts-panel', '.api-help-panel'])).toBe(false)
    expect(escapeCloses(e, parts, ['.demo-panel', '.api-help-panel'])).toBe(false)
    expect(escapeCloses(e, help, ['.demo-panel', '.parts-panel'])).toBe(true)
  })
})
