// Draws a model's triangles in the run-eval process, never in an executor: the crt sandbox has no WebGL.
// Playwright's bundled chromium is launched as apps/jscad-web/e2e/render-all.mjs launches it.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { chromium } from '@playwright/test'
import { VIEWS } from './views.js'

export const RENDER_SIZE = 768
export const LAUNCH_ARGS = ['--use-gl=angle', '--ignore-gpu-blocklist']

const nodeRequire = createRequire(import.meta.url)
// three 0.147's `exports` has no ./build/*; its main entry sits beside three.min.js.
const THREE = readFileSync(join(dirname(nodeRequire.resolve('three')), 'three.min.js'), 'utf8')
const PAGE = readFileSync(new URL('./render/page.html', import.meta.url), 'utf8')

const toBase64 = (positions) => Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).toString('base64')

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
    const renderNow = async (parts, dir) => {
      await page.evaluate(
        (payload) => window.drawModel(payload),
        parts.map(({ color, positions }) => ({ color, data: toBase64(positions) })),
      )
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
    let queue = Promise.resolve()
    return {
      render: (parts, dir) => {
        const next = queue.then(() => renderNow(parts, dir))
        queue = next.catch(() => {})
        return next
      },
      refused: () => refused,
      close: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// A result file's renders: <file stem>.renders/<fixture>-<run>/<view>.png beside
// it, paths relative to its directory. Chromium starts on the first render or `start()`.
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
    close: async () => {
      if (renderer) await (await renderer).close()
    },
  }
}
