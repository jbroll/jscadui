import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { dismissWelcome, waitForRender } from './helpers.js'

const sources = {
  'base.js': "const { cuboid } = require('@jscad/modeling').primitives\nconst makeBase = () => cuboid({ size: [20, 20, 2] })\nmodule.exports = { makeBase }\n",
  'peg.js': "const { cylinder } = require('@jscad/modeling').primitives\nconst makePeg = () => cylinder({ radius: 2, height: 4 })\nmodule.exports = { makePeg }\n",
  'main.js': "const { translate } = require('@jscad/modeling').transforms\nconst { makeBase } = require('./base.js')\nconst { makePeg } = require('./peg.js')\nconst main = () => [makeBase(), translate([5, 0, 3], makePeg()), translate([-5, 0, 3], makePeg())]\nmodule.exports = { main }\n",
}

// A run leaves the buffer dirty, so opening the next file asks to discard it.
const runInEditor = async (page, path, { discard, source = sources[path] }) => {
  await page.locator('#editor-file').click()
  await page.locator(`#editor-files .file-node[data-path="/${path}"] .file-open`).click()
  if (discard) await page.locator('.confirm-ok').click()
  await expect(page.locator('#editor-file')).toContainText(path)
  const content = page.locator('.cm-content')
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await content.press('Shift+Enter')
  await waitForRender(page)
}

const exportProject = async (page) => {
  await expect(page.locator('#export-format option[value="project"]')).toBeAttached()
  await page.selectOption('#export-format', 'project')
  await page.locator('#export-button').click()
}

const downloadZip = async (page) => {
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await exportProject(page)
  const zip = await download
  return { name: zip.suggestedFilename(), entries: unzipSync(readFileSync(await zip.path())) }
}

const expectNotAProject = async (page) => {
  let downloaded = false
  page.on('download', () => { downloaded = true })
  await exportProject(page)
  await expect(page.locator('#error-bar')).toContainText('open a project to export it')
  expect(downloaded).toBe(false)
}

test.describe('Project (zip) export', () => {
  test('downloads the code, params and one STL per printed part, and leaves the viewer as it was', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#editor-header .project-new').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.vertices)).toBe('0')
    for (const path of ['base.js', 'peg.js']) {
      page.once('dialog', (dialog) => dialog.accept(path))
      await page.locator('#editor-header .file-new').click()
      await expect(page.locator(`#editor-files .file-node[data-path="/${path}"]`)).toBeAttached()
    }
    for (const [i, path] of ['base.js', 'peg.js', 'main.js'].entries()) await runInEditor(page, path, { discard: i > 0 })
    await expect(page.locator('#error-bar')).not.toHaveClass(/visible/)
    const readVertices = () => page.evaluate(() => document.documentElement.dataset.vertices)
    await expect.poll(readVertices).toMatch(/^[1-9]/)
    const vertices = await readVertices()

    const zip = await downloadZip(page)
    expect(zip.name).toBe('Untitled.zip')
    expect(Object.keys(zip.entries).sort()).toEqual(['base.js', 'main.js', 'params.json', 'peg.js', 'stl/Untitled.stl', 'stl/base.stl', 'stl/peg-x2.stl'])
    expect(strFromU8(zip.entries['main.js'])).toBe(sources['main.js'])
    expect(JSON.parse(strFromU8(zip.entries['params.json']))).toEqual({})
    await expect(page.locator('#export-button')).toBeEnabled()
    await expect(page.locator('#error-bar')).not.toHaveClass(/visible/)
    expect(await page.evaluate(() => document.documentElement.dataset.render)).not.toBe('error')
    expect(await readVertices()).toBe(vertices)

    const stlList = (entries) => Object.keys(entries).filter((path) => path.startsWith('stl/')).sort()
    expect(stlList((await downloadZip(page)).entries)).toEqual(stlList(zip.entries))
    await page.evaluate(() => delete document.documentElement.dataset.render)
    await page.locator('.cm-content').press('Shift+Enter')
    await waitForRender(page)
    expect(await page.evaluate(() => document.documentElement.dataset.render)).toBe('ok')
    expect(await readVertices()).toBe(vertices)

    await page.keyboard.insertText('// not run\n')
    const edited = await downloadZip(page)
    expect(strFromU8(edited.entries['main.js'])).toBe(sources['main.js'])
    await expect(page.locator('#error-bar')).toContainText('unsaved edits are not in the export')
  })

  test('a dragged text drop loads nothing, so the open project still exports', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#editor-header .project-new').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.vertices)).toBe('0')
    await runInEditor(page, 'main.js', { discard: false, source: "const { cuboid } = require('@jscad/modeling').primitives\nmodule.exports = { main: () => cuboid() }\n" })
    await page.evaluate(() => {
      const dataTransfer = { items: [{ kind: 'string', type: 'text/plain' }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      document.body.dispatchEvent(drop)
    })
    const zip = await downloadZip(page)
    expect(Object.keys(zip.entries).sort()).toEqual(['main.js', 'params.json', 'stl/Untitled.stl'])
  })

  test('an example is not a project: no download, and the error says so', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await expectNotAProject(page)
  })

  test('a dropped single file is not a project: no download, and the error says so', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.evaluate((source) => {
      const file = { kind: 'file', name: 'peg.js', getFile: async () => new File([source], 'peg.js') }
      const dataTransfer = { items: [{ kind: 'file', getAsFileSystemHandle: async () => file }] }
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      document.body.dispatchEvent(drop)
    }, "const { cylinder } = require('@jscad/modeling').primitives\nmodule.exports = { main: () => cylinder({ radius: 2, height: 4 }) }\n")
    await expect(page.locator('#editor-file')).toContainText('peg.js')
    await waitForRender(page)
    await expectNotAProject(page)
  })
})
