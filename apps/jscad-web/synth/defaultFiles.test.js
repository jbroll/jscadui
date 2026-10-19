import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { productionDefaultFiles, seedModelDir } from './defaultFiles.js'

const webDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const example = (name) => readFileSync(join(webDir, 'examples/jscad/jscad-examples', name), 'utf8')

describe('productionDefaultFiles', () => {
  it('returns the two-cars pair under production names', () => {
    expect(productionDefaultFiles(webDir)).toEqual({
      'main.js': example('01-two-cars.example.js'),
      '02-hierarchical-car.example.js': example('02-hierarchical-car.example.js'),
    })
  })
})

describe('seedModelDir', () => {
  it('writes each file into the directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'synth-seed-'))
    try {
      seedModelDir(dir, { 'main.js': 'a', 'part.js': 'b' })
      expect(readFileSync(join(dir, 'main.js'), 'utf8')).toBe('a')
      expect(readFileSync(join(dir, 'part.js'), 'utf8')).toBe('b')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
