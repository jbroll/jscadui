import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

test.describe('project drawer', () => {
  test('opens, lists the default project, and shows versions', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    await expect(page.locator('#project-drawer:not(.closed)')).toBeVisible()
    await expect(page.locator('.project-row').first()).toContainText(/default|Untitled|Gear/i)
    expect(await page.locator('.version-row').count()).toBeGreaterThan(0)
  })

  test('a folder dropped on the open project runs its own model from the editor', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    const row = page.locator('.project-row', { hasText: 'default' })
    await row.locator('.project-open').click()

    // A folder drop as extractEntries reads it: a directory handle holding index.js.
    await row.evaluate((target) => {
      const source = 'module.exports = { main: () => { throw new Error("bracket ran") } }\n'
      const file = { kind: 'file', name: 'index.js', getFile: async () => new File([source], 'index.js') }
      const dir = { kind: 'directory', name: 'bracket', values: async function* () { yield file } }
      const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      target.dispatchEvent(drop)
    })
    await expect(page.locator('#editor-files button', { hasText: '/bracket/index.js' })).toBeAttached()
    await page.locator('#project-toggle').click()

    await page.locator('#editor-file').click()
    await page.locator('#editor-files button', { hasText: '/bracket/index.js' }).click()
    await expect(page.locator('.cm-content')).toContainText('bracket ran')
    await page.locator('.cm-content').press('Shift+Enter')
    await expect(page.locator('#error-bar')).toContainText('bracket ran')
  })

  test('drawer tabs do not overlap', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    const tabs = await Promise.all(
      ['#editor-toggle', '#project-toggle', '#ai-toggle'].map(async (sel) => {
        const box = await page.locator(sel).boundingBox()
        return { sel, top: box.y, bottom: box.y + box.height }
      }),
    )
    const sorted = [...tabs].sort((a, b) => a.top - b.top)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].top).toBeGreaterThanOrEqual(sorted[i - 1].bottom)
    }
  })
})
