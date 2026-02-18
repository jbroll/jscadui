import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

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

  test('clicking "ALL" loads all files in a grid and keeps panel open', async ({ page }) => {
    const allBtn = page.locator('.demo-all-btn').first()
    await expect(allBtn).toBeVisible({ timeout: 10_000 })
    await allBtn.click()

    // Panel should remain open
    await expect(page.locator('.demo-panel')).toBeVisible()
    await waitForRender(page, 30_000)
    await assertNoError(page)
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
