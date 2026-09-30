import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixFile, fixPaths, isDoubleEncoded, repair } from './fix-mojibake.js'

const doubleEncode = (text) => Buffer.from(text, 'utf8').toString('latin1')
const clean = '{"text":"x → y, 12 mm³ — ok, café"}'

describe('isDoubleEncoded', () => {
  it('is true for UTF-8 read back as latin1', () => {
    expect(doubleEncode(clean)).toContain('â\u0086\u0092')
    expect(isDoubleEncoded(doubleEncode(clean))).toBe(true)
  })
  it('is false for clean UTF-8', () => {
    expect(isDoubleEncoded(clean)).toBe(false)
  })
  it('is false for plain ASCII', () => {
    expect(isDoubleEncoded('{"a":1,"b":"plain text"}')).toBe(false)
  })
  it('is false when any character lies above U+00FF', () => {
    expect(isDoubleEncoded(`${doubleEncode('a → b')} ${'→'}`)).toBe(false)
  })
  it('is false when the latin1 bytes are not valid UTF-8', () => {
    expect(isDoubleEncoded('Ã© été» x')).toBe(false)
  })
})

describe('repair', () => {
  it('restores the original text', () => {
    expect(repair(doubleEncode(clean))).toBe(clean)
  })
  it('leaves text that is not double-encoded unchanged', () => {
    expect(repair(clean)).toBe(clean)
    expect(repair('ascii')).toBe('ascii')
  })
})

describe('fixPaths', () => {
  let dir
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('rewrites only the double-encoded .json files of a directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'fix-mojibake-'))
    writeFileSync(join(dir, 'bad.json'), doubleEncode(clean))
    writeFileSync(join(dir, 'good.json'), clean)
    writeFileSync(join(dir, 'notes.txt'), doubleEncode(clean))

    expect(fixPaths([dir])).toEqual([join(dir, 'bad.json')])
    expect(readFileSync(join(dir, 'bad.json'), 'utf8')).toBe(clean)
    expect(readFileSync(join(dir, 'good.json'), 'utf8')).toBe(clean)
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe(doubleEncode(clean))
  })

  it('repairs a file named directly, and a second pass changes nothing', () => {
    dir = mkdtempSync(join(tmpdir(), 'fix-mojibake-'))
    const file = join(dir, 'r.json')
    writeFileSync(file, doubleEncode(clean))
    expect(fixFile(file)).toBe(true)
    expect(fixFile(file)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(clean)
  })
})
