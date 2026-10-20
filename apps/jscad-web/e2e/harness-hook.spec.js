import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

test('the harness hook exposes the chat handlers when the flag is set', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('jscad-harness', '1'))
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)

  const view = await page.evaluate(() => globalThis.jscadHarness.view({ views: [{ preset: 'iso-front' }, { preset: 'top' }] }))
  expect(view.ok).toBe(true)
  expect(view.shots).toHaveLength(2)
  for (const shot of view.shots) expect(shot.image.dataUrl.startsWith('data:image/png;base64,')).toBe(true)

  // The boot example runs as a URL script, so the chat sees no build until a project file runs.
  // This pins a gap, not intended behavior: backlog "The starting example has no project build".
  const unbuilt = await page.evaluate(() => globalThis.jscadHarness.measure({}))
  expect(unbuilt.error.name).toBe('NoGeometryError')

  // A dropped folder opens as the project; running its file is a project build (as in project-ui.spec.js).
  const header = page.locator('#editor-header .project-header')
  await expect(header).toHaveAttribute('data-project-id', /.+/)
  await header.evaluate((target) => {
    const source = "const { cuboid } = require('@jscad/modeling').primitives\nmodule.exports = { main: () => cuboid({ size: [10, 10, 10] }) }\n"
    const file = { kind: 'file', name: 'index.js', getFile: async () => new File([source], 'index.js') }
    const dir = { kind: 'directory', name: 'cube', values: async function* () { yield file } }
    const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => dir }] }
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    target.dispatchEvent(drop)
  })
  const node = page.locator('#editor-files .file-node[data-path="/cube/index.js"]')
  await expect(node).toBeAttached()
  await page.locator('#editor-file').click()
  await node.locator('.file-open').click()
  await page.locator('.cm-content').press('Shift+Enter')
  await expect.poll(() => page.evaluate(() => globalThis.jscadHarness.measure({}).then((m) => m.ok))).toBe(true)

  const measure = await page.evaluate(() => globalThis.jscadHarness.measure({}))
  expect(typeof measure.volume).toBe('number')

  const check = await page.evaluate(() => globalThis.jscadHarness.check({}))
  expect(check.ok).toBe(true)

  const report = await page.evaluate(() => globalThis.jscadHarness.buildReport())
  expect(report.ok).toBe(true)
})

test('the harness hook is absent without the flag', async ({ page }) => {
  await page.goto('/')
  await dismissWelcome(page)
  expect(await page.evaluate(() => typeof globalThis.jscadHarness)).toBe('undefined')
})
