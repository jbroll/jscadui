import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('App loads', () => {
  test('page title is set', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/JSCAD/i)
  })

  test('viewer canvas is present', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await expect(page.locator('#viewer canvas')).toBeVisible()
  })

  test('menu button is present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#menu-button')).toBeVisible()
  })

  test('editor is present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#editor')).toBeVisible()
  })

  test('default model renders without error', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('progress bar disappears after render', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await expect(page.locator('#progress')).not.toBeVisible()
  })
})

test.describe('Menu', () => {
  test('opens and closes', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)

    const menuContent = page.locator('#menu-content')
    await expect(menuContent).not.toBeVisible()

    await page.locator('#menu-button').click()
    await expect(menuContent).toBeVisible()

    // Click the button again to toggle menu closed
    await page.locator('#menu-button').click()
    await expect(menuContent).not.toBeVisible()
  })

  test('"Browse Demos…" button is in the menu', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await page.locator('#menu-button').click()
    await expect(page.locator('#menu-content')).toContainText('Browse Demos')
  })
})
