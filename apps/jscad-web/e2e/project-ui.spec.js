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
