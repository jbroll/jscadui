import { test, expect } from '@playwright/test'
import { dismissWelcome, assertNoError } from './helpers.js'

test.describe('Demo browser panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    // Open the menu and click Browse Demos
    await page.locator('#menu-button').click()
    await page.locator('#menu-content').getByText('Browse Demos').click()
  })

  test('panel opens with title "Browse Demos"', async ({ page }) => {
    await expect(page.locator('.demo-panel')).toBeVisible()
    await expect(page.locator('.demo-panel')).toContainText('Browse Demos')
  })

  test('close button (×) dismisses the panel', async ({ page }) => {
    await page.locator('.demo-close-btn').click()
    await expect(page.locator('.demo-panel')).not.toBeVisible()
  })

  test('Escape key dismisses the panel', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(page.locator('.demo-panel')).not.toBeVisible()
  })

  test('clicking Browse Demos again toggles the panel closed', async ({ page }) => {
    await page.locator('#menu-button').click()
    await page.locator('#menu-content').getByText('Browse Demos').click()
    await expect(page.locator('.demo-panel')).not.toBeVisible()
  })

  test('examples directory loads and shows entries', async ({ page }) => {
    // The root dir auto-loads; wait for at least one file or dir entry
    const entry = page.locator('.demo-nav-file, .demo-nav-dir').first()
    await expect(entry).toBeVisible({ timeout: 10_000 })
  })

  test('clicking a file loads it and keeps panel open', async ({ page }) => {
    // Wait for files to load
    const fileBtn = page.locator('.demo-nav-file').first()
    await expect(fileBtn).toBeVisible({ timeout: 10_000 })
    await fileBtn.click()

    // Panel should remain open
    await expect(page.locator('.demo-panel')).toBeVisible()
    // The first entry is the whole-corpus ALL.js grid, too heavy to wait out
    // here; that it starts running is what this test is about.
    await page.waitForFunction(() => document.documentElement.dataset.render === 'running')
    await assertNoError(page)
  })

  test('on-disk ALL.js grid appears as a file entry', async ({ page }) => {
    // The dynamic "ALL" button was removed in favour of generated ALL.js files,
    // which appear as ordinary file entries.
    await expect(page.locator('.demo-nav-file', { hasText: 'ALL.js' }).first())
      .toBeVisible({ timeout: 10_000 })
  })

  test('clicking a directory navigates into it and updates breadcrumb', async ({ page }) => {
    const dirBtn = page.locator('.demo-nav-dir').first()
    await expect(dirBtn).toBeVisible({ timeout: 10_000 })
    const dirName = (await dirBtn.textContent()).replace('/', '').trim()
    await dirBtn.click()

    // Breadcrumb should now show root and the dir name
    await expect(page.locator('.demo-breadcrumb')).toContainText(dirName)
    // Should show some entries (files or dirs)
    const entry = page.locator('.demo-nav-file, .demo-nav-dir').first()
    await expect(entry).toBeVisible({ timeout: 10_000 })
  })

  const exactly = (text) => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
  const dirEntry = (page, name) => page.locator('.demo-nav-dir').filter({ hasText: exactly(name + '/') })
  const fileEntry = (page, name) => page.locator('.demo-nav-file').filter({ hasText: exactly(name) })
  const openDir = (page, name) => dirEntry(page, name).click()
  const openFile = (page, name) => fileEntry(page, name).click()

  test('a directory holding only one subdirectory opens that subdirectory', async ({ page }) => {
    await openDir(page, 'openscad')
    await openDir(page, 'dotscad')
    await expect(page.locator('.demo-crumb-current')).toHaveText('dotscad/examples/')
    await expect(fileEntry(page, 'ALL.js')).toBeVisible()
  })

  test('NopSCADlib tests are grouped into category folders', async ({ page }) => {
    await openDir(page, 'openscad')
    await openDir(page, 'nopscadlib')
    await expect(page.locator('.demo-crumb-current')).toHaveText('nopscadlib/NopSCADlib/tests/')
    for (const category of ['printed', 'utils', 'vitamins-electronics', 'vitamins-motion', 'vitamins-hardware', 'other']) {
      await expect(dirEntry(page, category)).toBeVisible()
    }
    await expect(fileEntry(page, 'box.scad')).toHaveCount(0)

    await openDir(page, 'printed')
    await expect(page.locator('.demo-crumb-current')).toHaveText('printed/')
    const model = page.waitForRequest(r => r.url().endsWith('/examples/openscad/nopscadlib/NopSCADlib/tests/box.scad'))
    await openFile(page, 'box.scad')
    await model

    const grid = page.waitForRequest(r => r.url().endsWith('/NopSCADlib/tests/ALL.printed.js'))
    await openFile(page, 'ALL.js')
    await grid

    await page.locator('.demo-crumb', { hasText: 'nopscadlib/NopSCADlib/tests/' }).click()
    await expect(page.locator('.demo-crumb-current')).toHaveText('nopscadlib/NopSCADlib/tests/')
  })

  test('breadcrumb root link navigates back to root', async ({ page }) => {
    // Navigate into first dir
    const dirBtn = page.locator('.demo-nav-dir').first()
    await expect(dirBtn).toBeVisible({ timeout: 10_000 })
    await dirBtn.click()

    // Click root breadcrumb to go back
    const rootCrumb = page.locator('.demo-crumb').first()
    await expect(rootCrumb).toBeVisible({ timeout: 5_000 })
    await rootCrumb.click()

    // Should be back at root - breadcrumb shows only current (no clickable crumbs)
    await expect(page.locator('.demo-crumb')).toHaveCount(0)
    await expect(page.locator('.demo-crumb-current')).toBeVisible()
  })
})
