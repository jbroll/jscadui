import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

/**
 * A fresh dir under the OS temp dir, removed when the calling test finishes.
 * @param {string} prefix
 */
export const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
