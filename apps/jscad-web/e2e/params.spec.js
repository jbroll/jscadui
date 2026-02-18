import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

/**
 * Load the balloons example, which has a rich set of parameters
 * (slider, checkbox, color, text, date, int) defined via getParameterDefinitions().
 */
test.describe('Parameter panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#./examples/balloons.example.js')
    await dismissWelcome(page)
    await waitForRender(page, 30_000)
    await assertNoError(page)
  })

  test('params panel is present', async ({ page }) => {
    await expect(page.locator('#paramsDiv')).toBeAttached()
  })

  test('slider input is visible for "count" parameter', async ({ page }) => {
    // The balloons example has a slider named "count"
    const slider = page.locator('input[type="range"]').first()
    await expect(slider).toBeVisible({ timeout: 10_000 })
  })

  test('changing a slider triggers a re-render', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()
    await expect(slider).toBeVisible({ timeout: 10_000 })

    // Change the slider value
    await slider.focus()
    await page.keyboard.press('ArrowRight')

    // Model should re-render
    await waitForRender(page, 30_000)
    await assertNoError(page)
  })

  test('checkbox input is visible', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"]').first()
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
  })

  test('toggling checkbox triggers a re-render', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"]').first()
    await expect(checkbox).toBeVisible({ timeout: 10_000 })

    await checkbox.click()
    await waitForRender(page, 30_000)
    await assertNoError(page)
  })
})

test.describe('Parameter panel – inline (params-proxy) style', () => {
  test.beforeEach(async ({ page }) => {
    // The hierarchical-car example uses the params-proxy inline parameter style
    await page.goto('/#./examples/hierarchical-car.example.js')
    await dismissWelcome(page)
    await waitForRender(page, 30_000)
  })

  test('params container is present', async ({ page }) => {
    // Either flat #paramsDiv or tree #paramsTreeContainer should exist
    const flat = page.locator('#paramsDiv')
    const tree = page.locator('#paramsTreeContainer')
    const hasFlat = await flat.count() > 0
    const hasTree = await tree.count() > 0
    expect(hasFlat || hasTree).toBe(true)
  })
})
