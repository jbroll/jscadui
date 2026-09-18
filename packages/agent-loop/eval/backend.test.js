import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

describe('eval backend', () => {
  it('evals fluent source and measures real volume', async () => {
    const backend = createEvalBackend()
    const evalRes = JSON.parse(await backend.requestTool('eval', { source: CUBE }))
    expect(evalRes.ok).toBe(true)
    expect(evalRes.entities).toBe(1)
    const measureRes = JSON.parse(await backend.requestTool('measure', {}))
    expect(measureRes.volume).toBeGreaterThan(7900)
    expect(measureRes.volume).toBeLessThan(8100)
  })

  it('answers measure with an error result when nothing was evaled', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('measure', {}))
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it('turns a throwing model into an error result, never a throw', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('eval', { source: 'throw new Error("boom")' }))
    expect(res.ok).toBe(false)
    expect(res.error.message).toBe('boom')
  })

  it('stubs view and export as unavailable without throwing', async () => {
    const backend = createEvalBackend()
    for (const name of ['view', 'export']) {
      const res = JSON.parse(await backend.requestTool(name, {}))
      expect(res.ok).toBe(false)
      expect(res.error.name).toBe('UnavailableError')
    }
  })

  it('writeModel persists to the memory project', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('writeModel', { source: CUBE, entry: 'main.js', message: 'first' }))
    expect(res.ok).toBe(true)
    expect(res.entry).toBe('main.js')
  })

  it('answers unknown tools with an error result', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('teleport', {}))
    expect(res.ok).toBe(false)
  })
})
