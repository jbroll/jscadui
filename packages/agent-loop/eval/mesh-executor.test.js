import { describe, expect, it } from 'vitest'
import { ExecutorExited } from './executor-protocol.js'
import { gradeInFreshExecutor } from './sandboxed-backend.js'
import { startExecutor } from './sandbox.js'

const CHILD = { kind: 'child' }
const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 }).colorize([0, 0, 1])] }'
const model = { files: { 'main.js': CUBE }, entry: 'main.js' }

const fakeExecutor = (mesh) => () => ({
  ready: Promise.resolve('fluent'),
  gradeProject: async () => ({ measure: { volume: 1 }, solid: null, params: [] }),
  mesh,
  close: () => {},
})

describe('gradeInFreshExecutor with mesh', () => {
  it('sends the graded model as a mesh from the same executor child', async () => {
    const graded = await gradeInFreshExecutor(() => startExecutor({ api: 'fluent', sandbox: CHILD }), model, { mesh: true })
    expect(graded.measure.volume).toBeCloseTo(8000, 0)
    expect(graded.mesh.parts).toHaveLength(1)
    expect(graded.mesh.parts[0].color).toEqual([0, 0, 1])
    expect(graded.mesh.parts[0].positions.length).toBe(12 * 9)
  }, 30_000)

  it('records an executor that ends mid-mesh as the mesh error', async () => {
    const graded = await gradeInFreshExecutor(
      fakeExecutor(async () => {
        throw new ExecutorExited('code 3')
      }),
      model,
      { mesh: true },
    )
    expect(graded.measure).toEqual({ volume: 1 })
    expect(graded.mesh.error).toMatch(/ended while sending the mesh \(code 3\)/)
  })

  it('asks for no mesh unless told to', async () => {
    let asked = false
    const graded = await gradeInFreshExecutor(
      fakeExecutor(async () => {
        asked = true
        return null
      }),
      model,
    )
    expect(asked).toBe(false)
    expect(graded).not.toHaveProperty('mesh')
  })
})
