// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import index from '@jscadui/agent-loop/api/index.json'
import { apiDiagnostics, apiHover, completeApi } from '../src/editorApi.js'

const stateFor = (doc) => EditorState.create({ doc, extensions: [javascript()] })

const complete = (doc, pos) => completeApi(index, new CompletionContext(stateFor(doc), pos, false))

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

  it('reports no syntax error in clean code longer than the initial parse covers', () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\n` + 'cylinder({ radius: 1, height: 2 })\n'.repeat(2000)
    expect(apiDiagnostics(index, stateFor(doc))).toEqual([])
  })
})

describe('editor autocomplete', () => {
  it('completes an API name by prefix', () => {
    const doc = 'cyli'
    const result = complete(doc, doc.length)
    expect(result.options.map((o) => o.label)).toContain('cylinder')
  })

  it('completes option keys inside a call object', () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({  })`
    const result = complete(doc, doc.indexOf('cylinder({') + 'cylinder({'.length)
    expect(result.options.map((o) => o.label)).toContain('height')
  })

  it('does not offer option keys outside an API call', () => {
    const doc = 'const x = {  }'
    expect(complete(doc, doc.indexOf('{ ') + 2)).toBe(null)
  })
})

describe('editor hover', () => {
  it('builds a tooltip for an API name', async () => {
    const doc = `const { cylinder } = require('@jscad/modeling').primitives\ncylinder({ radius: 1 })`
    const view = new EditorView({ state: stateFor(doc) })
    const source = apiHover(async () => index)
    const tooltip = await source(view, doc.indexOf('cylinder({') + 2)
    expect(tooltip).not.toBe(null)
    view.destroy()
  })
})
