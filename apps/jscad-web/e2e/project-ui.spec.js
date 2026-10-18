import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

test.describe('editor drawer projects', () => {
  test('header lists the default project and its versions', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    const projectSelect = page.locator('#editor-header .project-select')
    await expect(projectSelect).toBeVisible()
    await expect(projectSelect.locator('option').first()).toContainText(/default|Untitled|Gear/i)
    const versionSelect = page.locator('#editor-versions .version-select')
    await expect(versionSelect).toBeEnabled()
    expect(await versionSelect.locator('option').count()).toBeGreaterThan(0)
  })

  test('a folder dropped on the open project runs its own model from the editor', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    const header = page.locator('#editor-header .project-header')
    await expect(header).toHaveAttribute('data-project-id', /.+/)

    // A folder drop as extractEntries reads it: a directory handle holding index.js.
    await header.evaluate((target) => {
      const source = 'module.exports = { main: () => { throw new Error("bracket ran") } }\n'
      const file = { kind: 'file', name: 'index.js', getFile: async () => new File([source], 'index.js') }
      const dir = { kind: 'directory', name: 'bracket', values: async function* () { yield file } }
      const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      target.dispatchEvent(drop)
    })
    const node = page.locator('#editor-files .file-node[data-path="/bracket/index.js"]')
    await expect(node).toBeAttached()

    await page.locator('#editor-file').click()
    await node.locator('.file-open').click()
    await expect(page.locator('.cm-content')).toContainText('bracket ran')
    await page.locator('.cm-content').press('Shift+Enter')
    await expect(page.locator('#error-bar')).toContainText('bracket ran')
  })

  test('a folder dropped on the header merges, with the drop modal over the page', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    const header = page.locator('#editor-header .project-header')
    await expect(header).toHaveAttribute('data-project-id', /.+/)

    // The body dragover shows the full-screen #dropModal; it must not sit over
    // the header, or a real drop there would be captured by the page instead of
    // reaching the header's merge handler.
    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    })
    await expect(page.locator('#dropModal')).toBeVisible()
    const onHeader = await header.evaluate((target) => {
      const { x, y } = target.getBoundingClientRect()
      const hit = document.elementFromPoint(x + 4, y + 4)
      return target.contains(hit) || hit === target
    })
    expect(onHeader).toBe(true)

    // The drop at that point merges into the open project.
    await header.evaluate((target) => {
      const source = 'module.exports = { main: () => { throw new Error("row merge ran") } }\n'
      const file = { kind: 'file', name: 'index.js', getFile: async () => new File([source], 'index.js') }
      const dir = { kind: 'directory', name: 'widget', values: async function* () { yield file } }
      const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      const { x, y } = target.getBoundingClientRect()
      document.elementFromPoint(x + 4, y + 4).dispatchEvent(drop)
    })
    await expect(page.locator('#editor-files .file-node[data-path="/widget/index.js"]')).toBeAttached()
  })

  test('deletes a project after confirmation', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    const projects = page.locator('#editor-header .project-select option')
    // A second project, so deleting one leaves one behind and the app does not
    // recreate a replacement (which it does when the last project is deleted).
    await page.locator('#editor-header .project-new').click()
    await expect(projects).toHaveCount(2)
    await page.locator('#editor-header .project-delete').click()
    await page.locator('.confirm-ok').click()
    await expect(projects).toHaveCount(1)
  })

  test('drawer tabs do not overlap', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    const tabs = await Promise.all(
      ['#editor-toggle', '#ai-toggle'].map(async (sel) => {
        const box = await page.locator(sel).boundingBox()
        return { sel, top: box.y, bottom: box.y + box.height }
      }),
    )
    const sorted = [...tabs].sort((a, b) => a.top - b.top)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].top).toBeGreaterThanOrEqual(sorted[i - 1].bottom)
    }
  })

  test('opening chat shows the chat drawer over the editor', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await expect(page.locator('#editor-header .project-select')).toBeVisible()

    await page.locator('#ai-toggle').click()
    await expect(page.locator('#ai-drawer:not(.closed)')).toBeVisible()
    await settleDrawer(page, '#ai-drawer')
    expect(await drawerOnTop(page, '#ai-drawer')).toBe(true)
  })

  test('an open chat drawer steps the model-options menu aside on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await expect(page.locator('#model-options')).toBeVisible()

    await page.locator('#ai-toggle').click()
    await expect(page.locator('#ai-drawer:not(.closed)')).toBeVisible()
    await expect(page.locator('#model-options')).toBeHidden()
  })
})

/** Wait out the slide-in transition so the drawer's box is final. */
async function settleDrawer(page, selector) {
  await page.waitForFunction((sel) => {
    const { right, width } = document.querySelector(sel).getBoundingClientRect()
    return Math.abs(right - innerWidth) < 1 && width > 100
  }, selector)
}

/** True when the drawer covers the centre of its own box (nothing paints over it). */
async function drawerOnTop(page, selector) {
  return page.evaluate((sel) => {
    const drawer = document.querySelector(sel)
    const { x, y, width, height } = drawer.getBoundingClientRect()
    const hit = document.elementFromPoint(x + width / 2, y + height / 2)
    return drawer.contains(hit)
  }, selector)
}
