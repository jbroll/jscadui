import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'
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

// The red pixels in an 8-bit RGB or RGBA PNG; a blank or broken canvas has none.
const redPixels = (png) => {
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  const channels = { 2: 3, 6: 4 }[png[25]]
  const idat = []
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)))
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  let prior = Buffer.alloc(stride)
  let count = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0
      const b = prior[i]
      const c = i >= channels ? prior[i - channels] : 0
      const p = a + b - c
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      row[i] = (row[i] + [0, a, b, (a + b) >> 1, paeth][filter]) & 0xff
    }
    for (let i = 0; i < stride; i += channels) {
      if (row[i] > row[i + 1] + 40 && row[i] > row[i + 2] + 40) count += 1
    }
    prior = row
  }
  return count
}

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

  // On a host with no display, chromium's hardware GPU process exits during startup and the
  // first WebGL context goes with it: the first models came out as empty canvases.
  it('draws the first model on SwiftShader, whatever GPU and display the host has', async () => {
    let browser = null
    const renderer = await createRenderer({
      launch: async (options) => (browser = await chromium.launch(options)),
    })
    try {
      const parts = await partsOf([colors.colorize([0.78, 0.14, 0.13], primitives.cuboid({ size: [80, 30, 28] }))])
      const views = await renderer.render(parts, mkdtempSync(join(tmpdir(), 'render-test-')))
      for (const view of views) expect(redPixels(readFileSync(view.path))).toBeGreaterThan(RENDER_SIZE * RENDER_SIZE * 0.05)
      const [page] = browser.contexts()[0].pages()
      const gl = await page.evaluate(() => {
        const context = document.getElementById('c').getContext('webgl2')
        return { lost: context.isContextLost(), renderer: context.getParameter(context.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) }
      })
      expect(gl.lost).toBe(false)
      expect(gl.renderer).toMatch(/SwiftShader/)
    } finally {
      await renderer.close()
    }
  }, 60_000)
})
