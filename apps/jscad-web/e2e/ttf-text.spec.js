import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError, sampleCanvasCentre } from './helpers.js'

/**
 * E2E tests for the TTF text example (14-ttf-text.example.js).
 * Verifies that CDN Liberation fonts load in the browser and that
 * changing font/text parameters re-renders the model correctly.
 */
test.describe('TTF text example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#./examples/jscad/14-ttf-text.example.js')
    await dismissWelcome(page)
    // Allow extra time for CDN font download on first run
    await waitForRender(page, 60_000)
    await assertNoError(page)
  })

  test('renders with default parameters (Liberation Sans)', async ({ page }) => {
    // A model should be rendered — canvas centre should not be all-black background
    const pixel = await sampleCanvasCentre(page)
    expect(pixel).not.toBeNull()
    // The scene should have some rendered content (not all background colour)
    // Background is typically dark (0,0,0) or near-black; a rendered shape is lighter
    const isSomethingVisible = pixel.r > 10 || pixel.g > 10 || pixel.b > 10
    expect(isSomethingVisible).toBe(true)
  })

  test('params panel has font choice and text input', async ({ page }) => {
    const paramsDiv = page.locator('#paramsDiv')
    await expect(paramsDiv).toBeAttached()

    // Should have a select/choice for font
    const fontSelect = page.locator('select').first()
    await expect(fontSelect).toBeVisible({ timeout: 10_000 })

    // Should have a text input for the word
    const textInput = page.locator('input[type="text"]').first()
    await expect(textInput).toBeVisible({ timeout: 10_000 })
  })

  test('changing font triggers re-render without error', async ({ page }) => {
    const fontSelect = page.locator('select').first()
    await expect(fontSelect).toBeVisible({ timeout: 10_000 })

    // Switch to Liberation Serif
    await fontSelect.selectOption('Liberation Serif')
    await waitForRender(page, 60_000)
    await assertNoError(page)

    // Model should still be visible
    const pixel = await sampleCanvasCentre(page)
    expect(pixel).not.toBeNull()
  })

  test('changing text triggers re-render without error', async ({ page }) => {
    const textInput = page.locator('input[type="text"]').first()
    await expect(textInput).toBeVisible({ timeout: 10_000 })

    // Clear and type new text
    await textInput.fill('JSCAD')
    await textInput.press('Enter')
    await waitForRender(page, 60_000)
    await assertNoError(page)
  })

  test('Liberation Mono renders without error', async ({ page }) => {
    const fontSelect = page.locator('select').first()
    await expect(fontSelect).toBeVisible({ timeout: 10_000 })

    await fontSelect.selectOption('Liberation Mono')
    await waitForRender(page, 60_000)
    await assertNoError(page)
  })
})
