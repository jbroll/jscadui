import { expect } from '@playwright/test'

/**
 * Dismiss the welcome overlay if it is present.
 */
export async function dismissWelcome(page) {
  const welcome = page.locator('#welcome')
  try {
    await welcome.waitFor({ state: 'visible', timeout: 3000 })
    await page.locator('#welcome-dismiss').click()
    await welcome.waitFor({ state: 'hidden', timeout: 5000 })
  } catch {
    // welcome already gone or never appeared
  }
}

/**
 * Wait for the progress bar to finish and the model to be rendered.
 * Returns when the progress element is hidden (computation done).
 */
export async function waitForRender(page, timeout = 20_000) {
  // Progress bar hides when worker finishes
  await page.locator('#progress').waitFor({ state: 'hidden', timeout })
}

/**
 * Assert the error bar is not visible.
 */
export async function assertNoError(page) {
  await expect(page.locator('#error-bar')).not.toBeVisible()
}

/**
 * Sample the centre pixel of the WebGL canvas. Returns {r, g, b, a}.
 * A rendered scene will have a non-background centre in most cases.
 */
export async function sampleCanvasCentre(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#viewer canvas')
    if (!canvas) return null
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return null
    const px = new Uint8Array(4)
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1, 1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    )
    return { r: px[0], g: px[1], b: px[2], a: px[3] }
  })
}
