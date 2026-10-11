import { describe, expect, it } from 'vitest'
import { createEditorBuffer } from '../src/editorBuffer.js'

describe('editor buffer', () => {
  it('remembers loaded content and returns it after a switch away and back', () => {
    const b = createEditorBuffer()
    b.remember('/a.js', 'a1')
    b.remember('/b.js', 'b1')
    b.edit('/a.js', 'a2')
    expect(b.get('/a.js')).toBe('a2')
    expect(b.get('/b.js')).toBe('b1')
    expect(b.isDirty()).toBe(true)
  })

  it('clears on a whole-project replace', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.clear()
    expect(b.has('/a.js')).toBe(false)
    expect(b.isDirty()).toBe(false)
  })

  it('prunes buffers for paths no longer present but keeps the rest', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.edit('/b.js', 'b2')
    b.prune(new Set(['/a.js']))
    expect(b.has('/b.js')).toBe(false)
    expect(b.get('/a.js')).toBe('a2')
    expect(b.isDirty()).toBe(true)
  })

  it('is not dirty after a setSource-style remember of an edited path', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.remember('/a.js', 'a3')
    expect(b.isDirty()).toBe(false)
  })

  it('set updates text without changing the dirty flag', () => {
    const b = createEditorBuffer()
    b.remember('/a.js', 'a1')
    b.set('/a.js', 'a2')
    expect(b.get('/a.js')).toBe('a2')
    expect(b.isDirty()).toBe(false)
    b.edit('/b.js', 'b1')
    b.set('/b.js', 'b2')
    expect(b.get('/b.js')).toBe('b2')
    expect(b.isDirty()).toBe(true)
  })

  it('reports per-path dirty state', () => {
    const b = createEditorBuffer()
    b.remember('/a.js', 'a1')
    expect(b.isDirtyPath('/a.js')).toBe(false)
    b.edit('/a.js', 'a2')
    expect(b.isDirtyPath('/a.js')).toBe(true)
    b.remember('/a.js', 'a3')
    expect(b.isDirtyPath('/a.js')).toBe(false)
  })
})
