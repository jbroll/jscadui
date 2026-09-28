import { describe, expect, it } from 'vitest'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, isOwnBuildDirt, markerValue, needsBuild } from '../fetch-sources.js'

describe('isMainModule', () => {
  const moduleUrl = import.meta.url
  const realPath = fileURLToPath(moduleUrl)

  it('matches the direct path', () => {
    expect(isMainModule(realPath, moduleUrl)).toBe(true)
  })

  it('matches through a symlink, unlike a raw argv[1] comparison', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fetch-sources-symlink-'))
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

describe('needsBuild', () => {
  const build = ['npm install', 'npm run build']

  it('needs a build when there is no marker yet', () => {
    expect(needsBuild(null, 'abc123', build)).toBe(true)
  })

  it('needs a build when the commit moved', () => {
    expect(needsBuild(markerValue('oldsha', build), 'newsha', build)).toBe(true)
  })

  it('needs a build when the build list changes at the same commit', () => {
    expect(needsBuild(markerValue('abc123', build), 'abc123', ['npm install'])).toBe(true)
  })

  it('skips the build once the marker matches commit and build list exactly', () => {
    expect(needsBuild(markerValue('abc123', build), 'abc123', build)).toBe(false)
  })
})

describe('isOwnBuildDirt', () => {
  const build = ['npm install', 'npm run build']

  it('is dirt from our own build when the marker records the current HEAD', () => {
    expect(isOwnBuildDirt(markerValue('abc123', build), 'abc123')).toBe(true)
  })

  it('refuses when there is no marker', () => {
    expect(isOwnBuildDirt(null, 'abc123')).toBe(false)
  })

  it('refuses when the marker is for a different (older) commit', () => {
    expect(isOwnBuildDirt(markerValue('oldsha', build), 'abc123')).toBe(false)
  })
})
