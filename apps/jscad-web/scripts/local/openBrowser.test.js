// apps/jscad-web/scripts/local/openBrowser.test.js
import { describe, expect, it } from 'vitest'
import { openBrowser } from './openBrowser.js'

describe('openBrowser', () => {
  it('uses platform opener and never throws', async () => {
    const calls = []
    await openBrowser('http://localhost:7377/', {
      platform: 'linux',
      spawn: (cmd, args) => { calls.push([cmd, args]); return { unref: () => {}, on: () => {} } },
    })
    expect(calls[0][0]).toBe('xdg-open')
    expect(calls[0][1]).toEqual(['http://localhost:7377/'])
    await openBrowser('http://x/', { platform: 'darwin', spawn: () => { throw new Error('no browser') } })
  })
})
