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

  test('a folder dropped on a row merges, with the drop modal over the page', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    const row = page.locator('.project-row', { hasText: 'default' })
    await row.locator('.project-open').click()

    // The body dragover shows the full-screen #dropModal; it must not sit over
    // the row, or a real drop there would be captured by the page instead of
    // reaching the row handlers.
    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    })
    await expect(page.locator('#dropModal')).toBeVisible()
    const onRow = await row.evaluate((target) => {
      const { x, y } = target.getBoundingClientRect()
      const hit = document.elementFromPoint(x + 4, y + 4)
      return target.contains(hit) || hit === target
    })
    expect(onRow).toBe(true)

    // The drop at that point merges into the open project.
    await row.evaluate((target) => {
      const source = 'module.exports = { main: () => { throw new Error("row merge ran") } }\n'
      const file = { kind: 'file', name: 'index.js', getFile: async () => new File([source], 'index.js') }
      const dir = { kind: 'directory', name: 'widget', values: async function* () { yield file } }
      const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      const { x, y } = target.getBoundingClientRect()
      document.elementFromPoint(x + 4, y + 4).dispatchEvent(drop)
    })
    await expect(page.locator('#editor-files button', { hasText: '/widget/index.js' })).toBeAttached()
  })

  test('deletes a project after confirmation', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    const rows = page.locator('.project-row')
    // A second project, so deleting one leaves one behind and the app does not
    // recreate a replacement (which it does when the last project is deleted).
    await page.locator('.project-new').click()
    await expect(rows).toHaveCount(2)
    const before = await rows.count()
    await rows.first().locator('.project-delete').click()
    await page.locator('.confirm-ok').click()
    await expect(rows).toHaveCount(before - 1)
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
