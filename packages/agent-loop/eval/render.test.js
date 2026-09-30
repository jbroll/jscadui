import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'
import { collectMesh, meshPage, meshPages } from './mesh.js'
import { createRenderer, createRunRenderer, RENDER_SIZE } from './render.js'
import { VIEW_LABELS, VIEWS } from './views.js'

const { colors, primitives } = createRequire(import.meta.url)('@jscad/modeling')

// Playwright's bundled chromium, as apps/jscad-web/e2e/render-all.mjs uses; skips without it.
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
})()

const partsOf = async (geometry) => {
  const mesh = meshPages(geometry)
  return (await collectMesh(async (index) => meshPage(mesh, index))).parts
}

describe('views', () => {
  it('are the three views the describer reads, top view left out', () => {
    expect(VIEWS.map((v) => [v.name, v.dir, v.up])).toEqual([
      ['iso-front', [1, -1, 0.7], [0, 0, 1]],
      ['iso-back', [-1, 1, 0.7], [0, 0, 1]],
      ['side', [0, -1, 0.05], [0, 0, 1]],
    ])
    expect(VIEW_LABELS).toEqual({ 'iso-front': 'front three-quarter view', 'iso-back': 'back three-quarter view', side: 'side view' })
  })
})

describe('createRunRenderer', () => {
  it('renders into <file stem>.renders/<fixture>-<run>/ and gives paths relative to the result file', async () => {
    const dirs = []
    const fake = {
      render: async (_parts, dir) => {
        dirs.push(dir)
        return VIEWS.map((v) => ({ name: v.name, path: join(dir, `${v.name}.png`), sha256: 'a'.repeat(64) }))
      },
      close: async () => {},
    }
    const renderer = createRunRenderer('/data/results/2026-10-01T120000Z-m-fluent-complex-abcd1234.json', { start: async () => fake })
    const views = await renderer.render([], { fixture: 'toy-caboose', run: 2 })
    expect(dirs).toEqual(['/data/results/2026-10-01T120000Z-m-fluent-complex-abcd1234.renders/toy-caboose-2'])
    expect(views.map((v) => v.path)).toEqual(VIEWS.map((v) => `2026-10-01T120000Z-m-fluent-complex-abcd1234.renders/toy-caboose-2/${v.name}.png`))
    await renderer.close()
  })
})

describe.skipIf(!hasChromium)('createRenderer', () => {
  it('draws three 768 px views of a coloured model and refuses no request it never made', async () => {
    const renderer = await createRenderer()
    try {
      const parts = await partsOf([
        colors.colorize([0.78, 0.14, 0.13], primitives.cuboid({ size: [80, 30, 28] })),
        primitives.cylinder({ radius: 9, height: 6, center: [26, 17, -10] }),
      ])
      const dir = mkdtempSync(join(tmpdir(), 'render-test-'))
      const views = await renderer.render(parts, dir)
      expect(views.map((v) => v.name)).toEqual(VIEWS.map((v) => v.name))
      for (const view of views) {
        const png = readFileSync(view.path)
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([RENDER_SIZE, RENDER_SIZE])
        expect(view.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
      expect(new Set(views.map((v) => v.sha256)).size).toBe(3)
      expect(renderer.refused()).toBe(0)
    } finally {
      await renderer.close()
    }
  }, 60_000)
})
