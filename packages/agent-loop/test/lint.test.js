import { describe, expect, it } from 'vitest'
import { parser } from '@lezer/javascript'
import index from '../api/index.json'
import { firstError, hoverTarget, lintSource, lintTree } from '../src/lint.js'

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

describe('unknown function names', () => {
  it('flags an undeclared call whose first argument is an object', () => {
    expect(lint(`frobnicate({ a: 1 })`)).toEqual([
      expect.objectContaining({ severity: 'warning', fn: 'frobnicate' }),
    ])
  })

  it('accepts a locally declared function', () => {
    expect(lint(`function frobnicate(options) { return options }\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts an arrow assigned to a const', () => {
    expect(lint(`const frobnicate = (options) => options\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts a destructured binding', () => {
    expect(lint(`const { frobnicate } = require('./helper')\nfrobnicate({ a: 1 })`)).toEqual([])
  })

  it('accepts a global', () => {
    expect(lint(`Math.max(1, 2)`)).toEqual([])
  })

  it('accepts a call whose first argument is not an object', () => {
    expect(lint(`frobnicate(1)`)).toEqual([])
  })
})

describe('syntax errors', () => {
  it('flags an incomplete statement', () => {
    expect(lint(`const x = `)).toContainEqual(expect.objectContaining({ severity: 'error', message: 'Syntax error' }))
  })

  it('firstError returns the first severity error', async () => {
    const diagnostics = await lintSource(index, `const x = `)
    expect(firstError(diagnostics)).toMatchObject({ severity: 'error' })
    expect(firstError([])).toBe(undefined)
    expect(firstError([{ severity: 'warning' }])).toBe(undefined)
  })
})

describe('real fluent examples', () => {
  it('raise no static warning', async () => {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs')
    const { join, relative } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const REPO = fileURLToPath(new URL('../../../', import.meta.url))
    const FLUENT = /require\(\s*['"]@jbroll\/jscad-fluent['"]\s*\)/
    const dirs = ['apps/jscad-web/examples', 'packages/agent-loop/prompt/examples']
    const files = dirs.flatMap((dir) => {
      const base = join(REPO, dir)
      return existsSync(base) ? readdirSync(base, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(base, f)) : []
    })
    const warned = []
    let ran = 0
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!FLUENT.test(source)) continue
      ran += 1
      const diagnostics = await lintSource(index, source)
      if (diagnostics.length) warned.push({ name: relative(REPO, file), diagnostics })
    }
    expect(warned).toEqual([])
    expect(ran).toBeGreaterThanOrEqual(5)
  }, 60_000)
})

describe('hoverTarget', () => {
  const src = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`

  it('answers the docs entry for a name', () => {
    const target = hoverTarget(index, parser.parse(src), src.indexOf('cylinder({') + 2, src)
    expect(target.text).toContain('primitives.cylinder')
    expect(target.text).toContain('Options:')
  })

  it('answers the option line for an option key', () => {
    const target = hoverTarget(index, parser.parse(src), src.indexOf('radius') + 1, src)
    expect(target.text).toBe('radius: Number = 1 - radius of cylinder (at both start and end)')
  })

  it('answers null away from any name', () => {
    expect(hoverTarget(index, parser.parse(src), 0, src)).toBe(null)
  })
})
