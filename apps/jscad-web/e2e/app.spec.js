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

  test('opens while the compute frame is still loading', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL).origin
    await page.route(
      url => url.origin !== appOrigin,
      async route => {
        await new Promise(resolve => setTimeout(resolve, 5000))
        await route.continue()
      },
    )

    await page.goto('/', { waitUntil: 'commit' })
    await dismissWelcome(page)
    await page.locator('#menu-button').click()
    await expect(page.locator('#menu-content')).toBeVisible({ timeout: 2000 })
  })

  test('"Browse Demos…" button is in the menu', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await page.locator('#menu-button').click()
    await expect(page.locator('#menu-content')).toContainText('Browse Demos')
  })

  test('the render sweep can set the model timeout', async ({ page, context }) => {
    // The sweep raises it, so correctness is not graded on speed. Proved here
    // from the other end: a budget no model can meet must kill the model.
    await context.addInitScript(() => {
      try { localStorage.setItem('engine.modelTimeoutMs', '1') } catch { /* the app falls back to its default */ }
    })
    await page.goto('/?tiny-timeout#/examples/openscad/01-basics/cube.scad')
    await dismissWelcome(page)
    await waitForRender(page)
    await expect(page.locator('#error-bar')).toContainText('model exceeded 1 ms')
  })

  test('a first visit gets the manifold modeling engine', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await expect(page.locator('#modeling-engine')).toHaveValue('manifold')
  })
})
