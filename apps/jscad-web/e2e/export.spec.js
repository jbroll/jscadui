import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('Export panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('export format selector is present', async ({ page }) => {
    await expect(page.locator('#export-format')).toBeAttached()
  })

  test('export button is present', async ({ page }) => {
    await expect(page.locator('#export-button')).toBeVisible()
  })

  test('export format selector has options', async ({ page }) => {
    const select = page.locator('#export-format')
    await expect(select).toBeAttached()
    // Wait for options to be populated by the worker
    await expect(select.locator('option')).not.toHaveCount(0, { timeout: 15_000 })
  })

  test('STL format option is available', async ({ page }) => {
    const select = page.locator('#export-format')
    await expect(select.locator('option[value="stl"], option[value="stlb"]')).toBeAttached({ timeout: 15_000 })
  })

  test('clicking export button triggers a file download', async ({ page }) => {
    // Wait for export options to load
    await expect(page.locator('#export-format option')).not.toHaveCount(0, { timeout: 15_000 })

    // Set up download listener before clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })

    await page.locator('#export-button').click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.(stl|obj|3mf|svg|dxf|amf)$/i)
  })
})
