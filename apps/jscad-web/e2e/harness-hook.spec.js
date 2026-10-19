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

  const measure = await page.evaluate(() => globalThis.jscadHarness.measure({}))
  expect(measure.ok).toBe(true)
  expect(typeof measure.volume).toBe('number')

  const report = await page.evaluate(() => globalThis.jscadHarness.buildReport())
  expect(report.ok).toBe(true)
})

test('the harness hook is absent without the flag', async ({ page }) => {
  await page.goto('/')
  await dismissWelcome(page)
  expect(await page.evaluate(() => typeof globalThis.jscadHarness)).toBe('undefined')
})
