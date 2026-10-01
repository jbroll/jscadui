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

// Unfilters an 8-bit RGB or RGBA PNG's scanlines (Paeth and friends) for pixel-level checks.
const decodeRows = (png) => {
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  const channels = { 2: 3, 6: 4 }[png[25]]
  const idat = []
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)))
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  let prior = Buffer.alloc(stride)
  const rows = []
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
    rows.push(row)
    prior = row
  }
  return { width, height, channels, rows }
}

const countPixels = (png, test) => {
  const { width, channels, rows } = decodeRows(png)
  let count = 0
  for (const row of rows) {
    for (let i = 0; i < width * channels; i += channels) {
      if (test(row[i], row[i + 1], row[i + 2])) count += 1
    }
  }
  return count
}

// The red pixels in an 8-bit RGB or RGBA PNG; a blank or broken canvas has none.
const redPixels = (png) => countPixels(png, (r, g, b) => r > g + 40 && r > b + 40)

const partsOf = async (geometry) => {
  const mesh = meshPages(geometry)
  return (await collectMesh(async (index) => meshPage(mesh, index))).parts
}

describe('views', () => {
  it('are the four views the describer reads', () => {
    expect(VIEWS.map((v) => [v.name, v.dir, v.up])).toEqual([
      ['iso-front', [1, -1, 0.7], [0, 0, 1]],
      ['iso-back', [-1, 1, 0.7], [0, 0, 1]],
      ['side', [0.25, -1, 0.35], [0, 0, 1]],
      ['top', [0.15, -0.35, 1], [0, 1, 0]],
    ])
    expect(VIEW_LABELS).toEqual({
      'iso-front': 'front three-quarter view',
      'iso-back': 'back three-quarter view',
      side: 'side view',
      top: 'top view',
    })
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
  it('draws four 768 px views of a coloured model and refuses no request it never made', async () => {
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
      expect(new Set(views.map((v) => v.sha256)).size).toBe(VIEWS.length)
      expect(renderer.refused()).toBe(0)
    } finally {
      await renderer.close()
    }
  }, 60_000)

  it('gives uncoloured parts different palette colours by their index among them', async () => {
    const renderer = await createRenderer()
    try {
      const parts = await partsOf([primitives.cuboid({ size: [40, 40, 40], center: [-60, 0, 0] }), primitives.cuboid({ size: [40, 40, 40], center: [60, 0, 0] })])
      const views = await renderer.render(parts, mkdtempSync(join(tmpdir(), 'render-test-')))
      const png = readFileSync(views.find((v) => v.name === 'iso-front').path)
      // palette[0] #c8553d is red-heavy, palette[1] #3d7cc8 is blue-heavy; both must show up.
      expect(countPixels(png, (r, g, b) => r > g + 30 && r > b + 30)).toBeGreaterThan(RENDER_SIZE * RENDER_SIZE * 0.01)
      expect(countPixels(png, (r, g, b) => b > r + 30 && b > g + 20)).toBeGreaterThan(RENDER_SIZE * RENDER_SIZE * 0.01)
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
