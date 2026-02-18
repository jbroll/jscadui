import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('URL hash navigation', () => {
  test('loads an example file via URL hash', async ({ page }) => {
    await page.goto('/#./examples/primitives.example.js')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('editor shows the loaded script content', async ({ page }) => {
    await page.goto('/#./examples/primitives.example.js')
    await dismissWelcome(page)
    await waitForRender(page)

    // CodeMirror renders content inside .cm-content
    const editorContent = page.locator('.cm-content')
    await expect(editorContent).toBeVisible()
    // The primitives example should contain jscad modeling calls
    await expect(editorContent).toContainText('main')
  })

  test('error bar is hidden for a valid example', async ({ page }) => {
    await page.goto('/#./examples/primitives.example.js')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })
})
