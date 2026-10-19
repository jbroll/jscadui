import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

test('the harness hook exposes the chat handlers when the flag is set', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('jscad-harness', '1'))
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)

  const view = await page.evaluate(() => globalThis.jscadHarness.view({ views: [{ preset: 'iso-front' }, { preset: 'top' }] }))
  expect(view.ok).toBe(true)
  expect(view.shots).toHaveLength(2)
  for (const shot of view.shots) expect(shot.image.dataUrl.startsWith('data:image/png;base64,')).toBe(true)

  // The default model is not a project build, so measure answers with the chat's own no-geometry error.
  const measure = await page.evaluate(() => globalThis.jscadHarness.measure({}))
  expect(measure.ok).toBe(false)
  expect(measure.error.name).toBe('NoGeometryError')

  await page.evaluate(() => globalThis.jscadHarness.buildReport())
})

test('the harness hook is absent without the flag', async ({ page }) => {
  await page.goto('/')
  await dismissWelcome(page)
  expect(await page.evaluate(() => typeof globalThis.jscadHarness)).toBe('undefined')
})
