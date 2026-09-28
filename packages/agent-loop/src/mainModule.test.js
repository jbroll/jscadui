import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isMainModule } from './mainModule.js'

describe('isMainModule', () => {
  const moduleUrl = import.meta.url
  const realPath = fileURLToPath(moduleUrl)

  it('matches the direct path', () => {
    expect(isMainModule(realPath, moduleUrl)).toBe(true)
  })

  it('matches through a symlink, unlike a raw argv[1] comparison', () => {
    const dir = mkdtempSync(join(tmpdir(), 'main-module-symlink-'))
    const link = join(dir, 'linked.test.js')
    symlinkSync(realPath, link)
    expect(isMainModule(link, moduleUrl)).toBe(true)
  })

  it('rejects an unrelated path', () => {
    expect(isMainModule('/tmp/not-this-file.js', moduleUrl)).toBe(false)
  })

  it('rejects a missing argv[1]', () => {
    expect(isMainModule(undefined, moduleUrl)).toBe(false)
  })
})
