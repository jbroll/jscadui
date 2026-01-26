/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob } from './downloadBlob.js'

describe('downloadBlob', () => {
  let mockLink
  let createElementSpy
  let createObjectURLSpy
  let revokeObjectURLSpy

  beforeEach(() => {
    // Mock link element
    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    }

    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink)
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('creates an anchor element', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    expect(createElementSpy).toHaveBeenCalledWith('a')
  })

  it('creates object URL from blob', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    expect(createObjectURLSpy).toHaveBeenCalledWith(blob)
  })

  it('sets href to object URL', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    expect(mockLink.href).toBe('blob:test-url')
  })

  it('sets download attribute to filename', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'myfile.stl')

    expect(mockLink.download).toBe('myfile.stl')
  })

  it('triggers click on link', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    expect(mockLink.click).toHaveBeenCalled()
  })

  it('revokes object URL after delay', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    // URL should not be revoked immediately
    expect(revokeObjectURLSpy).not.toHaveBeenCalled()

    // Advance timers by 1000ms (REVOKE_DELAY_MS)
    vi.advanceTimersByTime(1000)

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-url')
  })

  it('does not revoke URL before delay expires', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    downloadBlob(blob, 'test.txt')

    // Advance by less than delay
    vi.advanceTimersByTime(500)

    expect(revokeObjectURLSpy).not.toHaveBeenCalled()
  })
})
