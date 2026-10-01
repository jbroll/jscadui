import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

// A catalog.json entry as packages/parts/bin/build.js writes it, with the real nopscadlib/nut paths.
const nutEntry = {
  id: 'nopscadlib/nut',
  family: 'nut',
  preferred: true,
  library: 'NopSCADlib',
  license: 'GPL-3.0',
  file: 'NopSCADlib/vitamins/nut.scad',
  call: 'nut',
  summary: 'DIN 934 / ISO 4032 metric hex nut.',
  sizes: { list: 'nuts' },
  options: { nyloc: 'add the nylon insert' },
  example: 'nut(M3_nut)',
  checks: [],
  signature: { params: [{ name: 'type' }] },
  sizeNames: ['M3_nut'],
  measured: [{ args: ['M3_nut'], size: [6.4, 5.543, 2.4] }],
  transpileMs: 10,
  buildMs: 5,
  thumb: 'thumbs/nopscadlib/nut.png',
  require: '_catalog/NopSCADlib/vitamins/nut.scad',
  scadIncludes: ['NopSCADlib/vitamins/nuts.scad', 'NopSCADlib/vitamins/nut.scad'],
}

test.describe('Parts browser panel', () => {
  test.beforeEach(async ({ page }) => {
    // The committed catalog has no admitted entries yet; serve a fixture.
    // Thumbnails are left unrouted and 404 from the dev server, as allowed.
    await page.route('**/parts/catalog.json', route => route.fulfill({ json: { entries: [nutEntry] } }))
    await page.goto('/')
    await dismissWelcome(page)
    // The editor is only ready for Insert once the default model's async init
    // chain (frame boot, editor.init()) has settled.
    await waitForRender(page)
    await page.locator('#menu-button').click()
    await page.locator('#menu-content').getByText('Browse Parts').click()
  })

  test('panel opens with a family entry', async ({ page }) => {
    await expect(page.locator('.parts-panel')).toBeVisible()
    await expect(page.locator('.parts-panel')).toContainText('Parts')
    await expect(page.locator('.parts-entry').first()).toBeVisible()
  })

  test('close button (×) dismisses the panel', async ({ page }) => {
    await page.locator('.parts-close-btn').click()
    await expect(page.locator('.parts-panel')).not.toBeVisible()
  })

  test('Escape key dismisses the panel', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(page.locator('.parts-panel')).not.toBeVisible()
  })

  test('with both panels open, Escape from outside them closes the newer one first', async ({ page }) => {
    await page.locator('#menu-button').click()
    await page.locator('#menu-content').getByText('Browse Demos').click()
    await expect(page.locator('.demo-panel')).toBeVisible()
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur())

    await page.keyboard.press('Escape')
    await expect(page.locator('.demo-panel')).not.toBeVisible()
    await expect(page.locator('.parts-panel')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.parts-panel')).not.toBeVisible()
  })

  test('opening an entry and clicking Insert writes the require and call into the editor', async ({ page }) => {
    await page.locator('.parts-entry').first().click()
    await expect(page.locator('.parts-insert')).toBeVisible()

    await page.locator('.parts-insert').click()

    const content = page.locator('.cm-content')
    await expect(content).toContainText("require('_catalog/NopSCADlib/vitamins/nut.scad')")
    await expect(content).toContainText('nut(M3_nut)')
  })
})
