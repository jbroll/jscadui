import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

// One page is one compute frame and one worker, so its transpiler and module
// caches carry from one model to the next. The render sweep gives every example
// a fresh page, so nothing else covers a second model landing on a warm worker.
const MODELS = [
  '/examples/openscad/nopscadlib/NopSCADlib/tests/screws.scad',
  '/examples/openscad/bosl2/01-part1/001-attachments-cuboid.scad',
  '/examples/openscad/nopscadlib/NopSCADlib/tests/screws.scad',
  '/examples/openscad/01-basics/cube.scad',
]

test('models from several projects run one after another in one session', async ({ page }) => {
  await page.goto(`/#${MODELS[0]}`)
  await dismissWelcome(page)
  await waitForRender(page)
  await assertNoError(page)

  for (const model of MODELS.slice(1)) {
    await page.evaluate(() => { document.documentElement.dataset.render = '' })
    await page.evaluate((hash) => { window.location.hash = hash }, model)
    await waitForRender(page)
    await expect(page.locator('#error-bar'), model).not.toBeVisible()
  }
})

// NopSCADlib's screw.scad and nut.scad `use` each other, so the transpiled
// modules require each other at the top level. A require that cannot hand a
// re-entrant caller its partial exports reports a circular dependency instead.
test('a model whose modules require each other renders', async ({ page }) => {
  await page.goto('/#/examples/openscad/nopscadlib/NopSCADlib/tests/antennas.scad')
  await dismissWelcome(page)
  await waitForRender(page)

  const error = await page.locator('#error-bar').textContent()
  expect(error ?? '').not.toContain('Circular dependency')
})
