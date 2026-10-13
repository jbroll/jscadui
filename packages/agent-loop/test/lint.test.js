import { describe, expect, it } from 'vitest'
import { parser } from '@lezer/javascript'
import index from '../api/index.json'
import { lintSource, lintTree } from '../src/lint.js'

const lint = (source, api = 'modeling') => lintTree(index, parser.parse(source), { api, text: source })

const DESTRUCTURED = `const { cylinder } = require('@jscad/modeling').primitives\n`

describe('unknown option keys', () => {
  it('flags a misspelled option with suggestions', () => {
    expect(lint(`${DESTRUCTURED}cylinder({ heigth: 2 })`)).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'jscad', fn: 'primitives.cylinder', option: 'heigth', suggestions: ['height'] }),
    ])
  })

  it('accepts every known option', () => {
    expect(lint(`${DESTRUCTURED}cylinder({ radius: 1, height: 2, segments: 8 })`)).toEqual([])
  })

  it('resolves a namespace-member call', () => {
    expect(lint(`const { primitives } = require('@jscad/modeling')\nprimitives.cylinder({ radius: 1, heigth: 2 })`)).toEqual([
      expect.objectContaining({ fn: 'primitives.cylinder', option: 'heigth' }),
    ])
  })

  it('resolves a jf factory through its sameAs options', () => {
    expect(lint(`jf.roundedCuboid({ radius: 1 })`, 'fluent')).toEqual([
      expect.objectContaining({ fn: 'jf.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] }),
    ])
  })

  it('ignores a call whose first argument is not an object literal', () => {
    expect(lint(`${DESTRUCTURED}cylinder(2)`)).toEqual([])
  })
})

describe('lintSource', () => {
  it('adds the line and column of the key', async () => {
    const [d] = await lintSource(index, `${DESTRUCTURED}cylinder({ heigth: 2 })`)
    expect(d).toMatchObject({ option: 'heigth', line: 2, column: 12 })
  })
})
