import { describe, expect, it } from 'vitest'
import index from '../api/index.json'
import { reportError } from '../src/modelError.js'

describe('reportError', () => {
  it("drops the worker's jscadMain prefix and locates the error in the project from its stack", () => {
    const error = { name: 'TypeError', message: 'jscadMain failed: x is not a function', stack: 'TypeError: x\n    at main (http://project.local/parts/gear.js:4:11)' }
    expect(reportError(error)).toEqual({ name: 'TypeError', message: 'x is not a function', file: 'parts/gear.js', line: 4, column: 11 })
  })

  it("locates a syntax error from the line and column Babel's message names", () => {
    const error = { name: 'SyntaxError', message: 'Babel transform failed for http://project.local/main.js: /http:/project.local/main.js: Unexpected token, expected "," (2:35)\n\n> 2 | x' }
    expect(reportError(error)).toMatchObject({ name: 'SyntaxError', file: 'main.js', line: 2, column: 36 })
  })

  it('keeps the file and loc an error already carries', () => {
    const error = { name: 'SyntaxError', message: 'Unexpected token (3:1)', file: 'helper.js', loc: { line: 3, column: 1 } }
    expect(reportError(error)).toEqual({ name: 'SyntaxError', message: 'Unexpected token (3:1)', file: 'helper.js', line: 3, column: 2 })
  })

  it('reads an Error instance, whose name and message are not own enumerable fields', () => {
    const error = new RangeError('too big')
    error.stack = 'RangeError: too big\n    at main (http://project.local/main.js:1:5)'
    expect(reportError(error)).toEqual({ name: 'RangeError', message: 'too big', file: 'main.js', line: 1, column: 5 })
  })

  it("drops the loader's failed-loading-module note, since the location names the file", () => {
    const error = { name: 'RangeError', message: 'too big / failed loading module ./part.js / failed loading module http://project.local/__run__.js', stack: 'RangeError: too big\n    at main (http://project.local/part.js:3:9)' }
    expect(reportError(error)).toEqual({ name: 'RangeError', message: 'too big', file: 'part.js', line: 3, column: 9 })
  })

  it('says out of memory for a failed allocation', () => {
    const error = { name: 'RangeError', message: 'jscadMain failed: Array buffer allocation failed', stack: 'RangeError: x\n    at main (http://project.local/main.js:2:5)' }
    expect(reportError(error)).toEqual({ name: 'RangeError', message: 'out of memory; try a smaller case', file: 'main.js', line: 2, column: 5 })
  })

  it('caps the message at 4,000 characters and the name at 200', () => {
    const out = reportError({ name: 'E'.repeat(300), message: 'x'.repeat(5000) })
    expect(out.message).toHaveLength(4000)
    expect(out.name).toHaveLength(200)
  })

  it('answers a thrown non-error as its text', () => {
    expect(reportError('boom')).toEqual({ name: 'Error', message: 'boom' })
  })

  it('adds the hint for the chat api', () => {
    const error = { name: 'TypeError', message: 'jf.measureVolume is not a function' }
    expect(reportError(error, { api: 'fluent', index }).message).toContain('measureVolume is a method of FluentGeom3')
  })
})
