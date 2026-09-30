import { describe, expect, it, vi } from 'vitest'
import { createReadFile, PROJECT_BASE, RUN_FILE } from '../src/projectUrl.js'

describe('project URLs', () => {
  it('puts project files under one synthetic base and a scratch run beside them', () => {
    expect(PROJECT_BASE).toBe('http://project.local/')
    expect(RUN_FILE).toBe('__run__.js')
  })

  it('reads a project path from the file map and never fetches it', () => {
    const fetchFile = vi.fn()
    const read = createReadFile({ 'lib/part.js': 'P' }, fetchFile)
    expect(read(`${PROJECT_BASE}lib/part.js`)).toBe('P')
    expect(() => read(`${PROJECT_BASE}gone.js`)).toThrow(`file not found ${PROJECT_BASE}gone.js`)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('hands any other path to fetchFile with its options', () => {
    const fetchFile = vi.fn(() => 'cdn source')
    const read = createReadFile({}, fetchFile)
    const url = 'https://cdn.jsdelivr.net/npm/@jscad/modeling'
    expect(read(url, { output: 'bytes' })).toBe('cdn source')
    expect(fetchFile).toHaveBeenCalledWith(url, { output: 'bytes' })
  })

  it('answers a path the map holds as given before fetching', () => {
    expect(createReadFile({ 'main.js': 'M' }, vi.fn())('main.js')).toBe('M')
  })
})
