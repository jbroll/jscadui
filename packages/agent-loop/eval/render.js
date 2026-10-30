// Draws a model's triangles in the run-eval process, never in an executor: the crt sandbox has no WebGL.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { chromium } from '@playwright/test'
import { clipPlanes, frameShot } from '../src/viewFrame.js'
import { DEFAULT_VIEW_SIZE } from '../src/viewSpec.js'
import { VIEWS } from './views.js'

export const RENDER_SIZE = 768
// SwiftShader from the start: with no display, the hardware GPU process exits during startup and takes the first WebGL context with it.
export const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader']

const nodeRequire = createRequire(import.meta.url)
// three 0.147's `exports` has no ./build/*; its main entry sits beside three.min.js.
const THREE = readFileSync(join(dirname(nodeRequire.resolve('three')), 'three.min.js'), 'utf8')
const PAGE = readFileSync(new URL('./render/page.html', import.meta.url), 'utf8')

// The app's light theme background, the default a prod `view` call renders on.
export const VIEW_BG = [0.99, 0.99, 0.99]

const toBase64 = (positions) => Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).toString('base64')

const boxOf = (parts) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 1) {
      min[i % 3] = Math.min(min[i % 3], positions[i])
      max[i % 3] = Math.max(max[i % 3], positions[i])
    }
  }
  return { min, max }
}

// One browser and one page per process, one model at a time. The page is set
// as content and three.js added inline, so it needs no request; any it makes is refused.
export const createRenderer = async ({ launch = (options) => chromium.launch(options) } = {}) => {
  const browser = await launch({ headless: true, args: LAUNCH_ARGS })
  let refused = 0
  try {
    const page = await browser.newPage({ viewport: { width: RENDER_SIZE, height: RENDER_SIZE } })
    await page.route('**/*', (route) => {
      refused += 1
      return route.abort()
    })
    await page.setContent(PAGE)
    await page.addScriptTag({ content: THREE })
    const payload = (parts) => parts.map(({ color, positions }) => ({ color, data: toBase64(positions) }))
    const draw = (parts) => page.evaluate((input) => window.drawModel(input), payload(parts))
    const renderNow = async (parts, dir) => {
      await draw(parts)
      mkdirSync(dir, { recursive: true })
      const views = []
      for (const view of VIEWS) {
        await page.evaluate(({ dir: from, up }) => window.renderView(from, up), view)
        const png = await page.locator('#c').screenshot()
        const path = join(dir, `${view.name}.png`)
        writeFileSync(path, png)
        views.push({ name: view.name, path, sha256: createHash('sha256').update(png).digest('hex') })
      }
      return views
    }
    // The `view` tool's renderer contract (src/viewHandler.js): one PNG data URL and camera per shot, nothing on disk.
    // Framed here with the app's math, so the page only draws.
    const shootNow = async (parts, { shots, size = DEFAULT_VIEW_SIZE }) => {
      await page.evaluate(({ input, bg }) => window.drawShotModel(input, bg), { input: payload(parts), bg: VIEW_BG })
      const model = boxOf(parts)
      const results = []
      for (const shot of shots) {
        const camera = frameShot(shot, model, size)
        await page.evaluate(({ view, w, h }) => window.renderShot(view, w, h), { view: { ...camera, ...clipPlanes(camera) }, w: size.w, h: size.h })
        const png = await page.locator('#c').screenshot()
        results.push({ pngDataUrl: `data:image/png;base64,${png.toString('base64')}`, camera })
      }
      return results
    }
    let queue = Promise.resolve()
    const queued = (job) => {
      const next = queue.then(job)
      queue = next.catch(() => {})
      return next
    }
    return {
      render: (parts, dir) => queued(() => renderNow(parts, dir)),
      renderShots: (parts, plan) => queued(() => shootNow(parts, plan)),
      refused: () => refused,
      close: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// A result file's renders: <file stem>.renders/<fixture>-<run>/<view>.png beside
// it, paths relative to its directory, and the `view` tool's shots, kept in memory.
// Chromium starts on the first render or `start()`.
export const createRunRenderer = (filePath, { start = () => createRenderer() } = {}) => {
  const dir = dirname(filePath)
  const stem = basename(filePath, '.json')
  let renderer = null
  const started = () => (renderer ??= start())
  return {
    start: started,
    render: async (parts, { fixture, run }) => {
      const views = await (await started()).render(parts, join(dir, `${stem}.renders`, `${fixture}-${run}`))
      return views.map((view) => ({ ...view, path: relative(dir, view.path) }))
    },
    renderShots: async (parts, plan) => (await started()).renderShots(parts, plan),
    close: async () => {
      if (renderer) await (await renderer).close()
    },
  }
}
