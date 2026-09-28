import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEvalBackend, createReadFile, EXPORT_REG, IMPORT_REG } from './backend.js'

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

const ESM_SPHERE = `import { primitives } from '@jscad/modeling'
export const main = (params) => {
  params.radius = { type: 'slider', default: 5, min: 1, max: 10 }
  return primitives.sphere({ radius: params.radius })
}`

const evalSource = async (source) => JSON.parse(await createEvalBackend().requestTool('eval', { source }))

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

  it('runs an ES module that imports @jscad/modeling and reports its slider', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('eval', { source: ESM_SPHERE }))
    expect(res.ok).toBe(true)
    expect(res.params).toContainEqual(expect.objectContaining({ name: 'radius', type: 'slider', initial: 5 }))
    expect(backend.params()).toEqual(res.params)
    const volume = JSON.parse(await backend.requestTool('measure', {})).volume
    expect(volume).toBeGreaterThan(480)
    expect(volume).toBeLessThan(530)
  })

  it('fails a package that is not installed with the frame CDN error text', async () => {
    const res = await evalSource(`import { sphere } from '@jscad/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('failed to load module @jscad/primitives')
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/primitives')
  })

  it('fails a package subpath the frame does not alias', async () => {
    const res = await evalSource(`import { sphere } from '@jscad/modeling/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/modeling/primitives.js')
  })

  it('rejects export without an import line, as the frame does', async () => {
    const res = await evalSource('export const main = () => []')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('SyntaxError')
  })

  it('uses the same transform test as the worker', () => {
    const worker = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8')
    expect(worker).toContain(`const importReg = ${IMPORT_REG}`)
    expect(worker).toContain(`const exportReg = ${EXPORT_REG}`)
  })

  it('maps project and CDN URLs like the frame', () => {
    const read = createReadFile({ 'main.js': 'X' })
    expect(read('http://project.local/main.js')).toBe('X')
    expect(() => read('http://project.local/other.js')).toThrow('file not found http://project.local/other.js')
    expect(read('https://cdn.jsdelivr.net/npm/@jscad/modeling@2.12.0')).toContain('"@jscad/modeling"')
    expect(() => read('https://cdn.jsdelivr.net/npm/no-such-package-xyz')).toThrow('file not found https://cdn.jsdelivr.net/npm/no-such-package-xyz')
  })

  it('answers measure with an error result when nothing was evaled', async () => {
    const res = JSON.parse(await createEvalBackend().requestTool('measure', {}))
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it('turns a throwing model into an error result, never a throw', async () => {
    const res = await evalSource('throw new Error("boom")')
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/^boom/)
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
    expect(backend.project.get('main.js').message).toBe('first')
  })

  it('answers unknown tools with an error result', async () => {
    const res = JSON.parse(await createEvalBackend().requestTool('teleport', {}))
    expect(res.ok).toBe(false)
  })

  it('answers docs from the API index', async () => {
    const backend = createEvalBackend()
    expect(await backend.requestTool('docs', { query: 'roundedCuboid' })).toContain('roundRadius: Number = 0.2')
    expect(JSON.parse(await backend.requestTool('docs', { query: 'roundedCube' })).error.name).toBe('NotFoundError')
  })
})
