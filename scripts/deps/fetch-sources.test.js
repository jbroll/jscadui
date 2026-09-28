import { describe, expect, it } from 'vitest'
import { markerValue, needsBuild } from '../fetch-sources.js'

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
