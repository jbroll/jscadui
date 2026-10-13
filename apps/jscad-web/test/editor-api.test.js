// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import index from '@jscadui/agent-loop/api/index.json'
import { apiDiagnostics } from '../src/editorApi.js'

const stateFor = (doc) => EditorState.create({ doc, extensions: [javascript()] })

describe('editor lint diagnostics', () => {
  it('flags an unknown option', () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ heigth: 2 })`
    expect(apiDiagnostics(index, stateFor(doc))).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'jscad', fn: 'primitives.cylinder', option: 'heigth' }),
    ])
  })

  it('flags a syntax error', () => {
    expect(apiDiagnostics(index, stateFor('const x = '))).toEqual([expect.objectContaining({ severity: 'error' })])
  })

  it('is empty for clean code', () => {
    expect(apiDiagnostics(index, stateFor(`const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`))).toEqual([])
  })
})
