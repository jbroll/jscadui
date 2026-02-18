import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('Demo browser dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    // Open the menu and click Browse Demos
    await page.locator('#menu-button').click()
    await page.locator('#menu-content').getByText('Browse Demos').click()
  })

  test('dialog opens with title "Browse Demos"', async ({ page }) => {
    await expect(page.locator('.demo-dialog')).toBeVisible()
    await expect(page.locator('.demo-dialog')).toContainText('Browse Demos')
  })

  test('close button (×) dismisses the dialog', async ({ page }) => {
    await page.locator('.demo-close-btn').click()
    await expect(page.locator('.demo-dialog')).not.toBeVisible()
  })

  test('Escape key dismisses the dialog', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(page.locator('.demo-dialog')).not.toBeVisible()
  })

  test('clicking the overlay background dismisses the dialog', async ({ page }) => {
    // Click outside the dialog box but inside the overlay
    await page.locator('.demo-overlay').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.demo-dialog')).not.toBeVisible()
  })

  test('examples directory loads and shows file entries', async ({ page }) => {
    // The root dir auto-expands; wait for at least one file or dir entry
    const fileBtn = page.locator('.demo-file-btn').first()
    await expect(fileBtn).toBeVisible({ timeout: 10_000 })
  })

  test('clicking a file loads it and closes the dialog', async ({ page }) => {
    // Wait for files to load
    const fileBtn = page.locator('.demo-file-btn').first()
    await expect(fileBtn).toBeVisible({ timeout: 10_000 })
    await fileBtn.click()

    // Dialog should close
    await expect(page.locator('.demo-dialog')).not.toBeVisible()
    // Model should render
    await waitForRender(page)
    await assertNoError(page)
  })

  test('"ALL" button appears when a directory has files', async ({ page }) => {
    // Root examples dir has files, so ALL button should appear
    await expect(page.locator('.demo-all-btn').first()).toBeVisible({ timeout: 10_000 })
  })

  test('"ALL" button shows file count', async ({ page }) => {
    const allBtn = page.locator('.demo-all-btn').first()
    await expect(allBtn).toBeVisible({ timeout: 10_000 })
    // Text should match "ALL (N file)" or "ALL (N files)"
    await expect(allBtn).toContainText(/ALL \(\d+ files?\)/)
  })

  test('clicking "ALL" loads all files in a grid and closes the dialog', async ({ page }) => {
    const allBtn = page.locator('.demo-all-btn').first()
    await expect(allBtn).toBeVisible({ timeout: 10_000 })
    await allBtn.click()

    await expect(page.locator('.demo-dialog')).not.toBeVisible()
    await waitForRender(page, 30_000)
    await assertNoError(page)
  })
})
