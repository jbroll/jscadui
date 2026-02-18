import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

test.describe('Code editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
  })

  test('editor container is visible', async ({ page }) => {
    await expect(page.locator('#editor')).toBeVisible()
  })

  test('CodeMirror content is editable', async ({ page }) => {
    const content = page.locator('.cm-content')
    await expect(content).toBeVisible()
    await expect(content).toHaveAttribute('contenteditable', 'true')
  })

  test('editor shows default script content', async ({ page }) => {
    const content = page.locator('.cm-content')
    await expect(content).toContainText('main')
  })

  test('Shift+Enter re-runs the script', async ({ page }) => {
    // Wait for initial render to complete
    await assertNoError(page)

    // Replace editor content via CodeMirror's internal dispatch mechanism.
    // ContentView.get(node) === node.cmView; rootView.view is the EditorView.
    await page.evaluate(() => {
      const cmContent = document.querySelector('.cm-content')
      const view = cmContent?.cmView?.rootView?.view
      if (!view) return
      const code = [
        "const { sphere } = require('@jscad/modeling').primitives",
        'const main = () => sphere({ radius: 10 })',
        'module.exports = { main }',
      ].join('\n')
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } })
    })

    await page.locator('.cm-content').press('Shift+Enter')
    await waitForRender(page)
    await assertNoError(page)
  })

  test('Ctrl+S re-runs the script', async ({ page }) => {
    await assertNoError(page)

    await page.evaluate(() => {
      const cmContent = document.querySelector('.cm-content')
      const view = cmContent?.cmView?.rootView?.view
      if (!view) return
      const code = [
        "const { cube } = require('@jscad/modeling').primitives",
        'const main = () => cube({ size: 5 })',
        'module.exports = { main }',
      ].join('\n')
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } })
    })

    await page.locator('.cm-content').press('Control+s')
    await waitForRender(page)
    await assertNoError(page)
  })

  test('syntax error shows in error bar', async ({ page }) => {
    const content = page.locator('.cm-content')
    await content.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('this is not valid javascript !!!@@@###')
    await page.keyboard.press('Shift+Enter')

    // Wait for the error bar to appear
    await expect(page.locator('#error-bar')).toBeVisible({ timeout: 15_000 })
  })

  test('editor hint text is visible', async ({ page }) => {
    // At least one of the hint elements should be present
    const hint1 = page.locator('#editor-hint')
    const hint2 = page.locator('#editor-hint2')
    const either = hint1.or(hint2)
    await expect(either.first()).toBeAttached()
  })
})
