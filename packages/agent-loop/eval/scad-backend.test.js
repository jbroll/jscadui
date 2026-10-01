import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'

process.env.JSCAD_LIBS_DIR = fileURLToPath(new URL('../../parts/test/fixtures/libs/', import.meta.url))
let createEvalBackend, createEvalReadFile
beforeAll(async () => { ({ createEvalBackend, createEvalReadFile } = await import('./backend.js')) })

describe('eval backend .scad support', () => {
  it('runs a js project that requires a library part', async () => {
    const backend = createEvalBackend()
    const files = { 'main.js': "const { block, M3_block } = require('Mini/mini.scad')\nmodule.exports = { main: () => block(M3_block) }\n" }
    await backend.reset(files, { build: true })
    const result = JSON.parse(await backend.requestTool('measure', {}))
    expect(result.dimensions).toEqual([6, 6, 3])
  })

  it('runs a project scad file that includes a library part', async () => {
    const backend = createEvalBackend()
    const files = { 'main.js': "module.exports = require('./part.scad')\n", 'part.scad': 'include <Mini/mini.scad>\nblock(M2_block);\n' }
    await backend.reset(files, { build: true })
    const result = JSON.parse(await backend.requestTool('measure', {}))
    expect(result.dimensions).toEqual([4, 4, 2])
  })

  it('reads a library file but refuses a path that climbs out of the libs dir', () => {
    const read = createEvalReadFile({})
    expect(read('http://app.local/libs/Mini/mini.scad')).toContain('module block')
    expect(() => read('http://app.local/libs/Mini/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).toThrow(/file not found/)
  })

  it('fails the build of a model whose library require climbs out of the libs dir', async () => {
    const backend = createEvalBackend()
    const report = await backend.reset({ 'main.js': "module.exports = require('Mini/../../../../../../etc/passwd')\n" }, { build: true })
    expect(report.ok).toBe(false)
    expect(JSON.stringify(report)).not.toContain('root:')
  })
})
