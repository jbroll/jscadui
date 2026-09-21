import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
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

  test('exports the render branch, not the previewed one', async ({ page }) => {
    // Three model runs: the preview, the render the export needs, and the
    // preview the frame restores afterwards.
    test.setTimeout(120_000)
    // preview-gate.scad draws a 10mm cube under $preview and a 30mm one without.
    // A query change forces a full document load, so the model gets a fresh
    // frame rather than the one the beforeEach already used.
    await page.goto('/?preview-gate#/examples/openscad/01-basics/preview-gate.scad')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)

    await expect(page.locator('#export-format option')).not.toHaveCount(0, { timeout: 15_000 })
    await page.selectOption('#export-format', 'stla')

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.locator('#export-button').click()
    const download = await downloadPromise

    const stl = readFileSync(await download.path(), 'utf8')
    const extent = Math.max(...(stl.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/gi) || []).map(Number))
    expect(extent).toBeGreaterThan(10)
  })
})
