import { test, expect } from '@playwright/test'

const readTriangles = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#stats-content .stat-row')]
  const row = rows.find((r) => r.querySelector('.stat-label')?.textContent === 'Triangles')
  return row ? parseInt(row.querySelector('.stat-value').textContent, 10) : null
})

const SPHERE = (segments) => [
  `const { sphere } = require('@jscad/modeling').primitives`,
  `const main = (params) => {`,
  `  params.segments = { type: 'slider', default: ${segments}, min: 4, max: 64 }`,
  `  return sphere({ radius: 10, segments: params.segments })`,
  `}`,
  `module.exports = { main }`,
].join('\n')

test('renders a model through the frame, edits it, and shows parameter controls', async ({ page }) => {
  await page.goto('/')

  // The default model loads through the frame on startup.
  await expect(page.locator('#viewer canvas')).toBeVisible()
  await expect(page.locator('#stats-content')).toContainText('Triangles', { timeout: 60000 })
  await expect(page.locator('#paramsTreeContainer input').first()).toBeVisible({ timeout: 60000 })
  await expect(page.locator('#error-bar')).not.toHaveClass(/visible/)
  const initial = await readTriangles(page)
  expect(initial).toBeGreaterThan(0)

  // Recompile with different geometry; the frame must re-run and redraw.
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  // insertText is paste-like, so CodeMirror's auto-close brackets do not
  // double up the typed braces.
  await page.keyboard.insertText(SPHERE(8))
  await page.keyboard.press('Shift+Enter')

  await expect.poll(() => readTriangles(page), { timeout: 60000 }).not.toBe(initial)
  await expect(page.locator('#error-bar')).not.toHaveClass(/visible/)
  await expect(page.locator('#paramsTreeContainer input').first()).toBeVisible()
})