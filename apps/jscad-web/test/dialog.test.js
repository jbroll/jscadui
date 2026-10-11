// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { confirm } from '../src/ui/dialog.js'

describe('confirm dialog', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('resolves true when the confirm label is clicked', async () => {
    const p = confirm({ title: 'Delete?', message: 'gone', confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    document.querySelector('.confirm-ok').click()
    expect(await p).toBe(true)
    expect(document.querySelector('.confirm-overlay')).toBeNull()
  })

  it('resolves false on cancel', async () => {
    const p = confirm({ title: 'Keep?', message: 'x', confirmLabel: 'Discard', cancelLabel: 'Keep edits' })
    document.querySelector('.confirm-cancel').click()
    expect(await p).toBe(false)
  })

  it('resolves false on a backdrop click', async () => {
    const p = confirm({ title: 'x', message: 'y' })
    const overlay = document.querySelector('.confirm-overlay')
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await p).toBe(false)
  })
})
