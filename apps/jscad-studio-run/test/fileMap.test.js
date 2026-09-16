import { describe, it, expect, vi } from 'vitest'
import { createReadFile, PROJECT_BASE } from '../src/fileMap.js'

describe('createReadFile', () => {
  const files = {
    'main.js': 'export const main = () => cube({ size: 1 })',
    'parts/part.scad': 'cube(1);',
  }

  it('resolves a project path to its text', () => {
    const readFile = createReadFile(files, () => {
      throw new Error('should not fetch')
    })
    expect(readFile(`${PROJECT_BASE}parts/part.scad`)).toBe('cube(1);')
    expect(readFile('main.js')).toBe('export const main = () => cube({ size: 1 })')
  })

  it('throws file not found for a missing project path', () => {
    const readFile = createReadFile(files, () => {
      throw new Error('should not fetch')
    })
    expect(() => readFile(`${PROJECT_BASE}missing.js`)).toThrow(/file not found/)
  })

  it('falls through to the loader fetch for a bare package name', () => {
    const fetchFile = vi.fn(() => 'module source')
    const readFile = createReadFile(files, fetchFile)
    expect(readFile('@jscad/modeling')).toBe('module source')
    expect(fetchFile).toHaveBeenCalledWith('@jscad/modeling', undefined)
  })

  it('falls through to the loader fetch for an absolute CDN URL', () => {
    const fetchFile = vi.fn(() => 'cdn source')
    const readFile = createReadFile(files, fetchFile)
    const url = 'https://cdn.jsdelivr.net/npm/@jscad/modeling@2.12.8/src/index.js'
    expect(readFile(url)).toBe('cdn source')
    expect(fetchFile).toHaveBeenCalledWith(url, undefined)
  })
})