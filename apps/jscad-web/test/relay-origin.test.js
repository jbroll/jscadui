import { describe, expect, it } from 'vitest'
import { relayOrigin } from '../src_build/relayOrigin.js'

describe('relayOrigin', () => {
  it('uses the app origin for a deployed or launcher build, which serves its own relay', () => {
    expect(relayOrigin({ dev: false, appOrigin: 'https://jscad.rkroll.com', env: {} })).toBe('https://jscad.rkroll.com')
    expect(relayOrigin({ dev: false, appOrigin: 'http://localhost:7377', env: {} })).toBe('http://localhost:7377')
  })

  it('points the dev server, which has no relay, at production', () => {
    expect(relayOrigin({ dev: true, appOrigin: 'http://localhost:5120', env: {} })).toBe('https://jscad.rkroll.com')
  })

  it('honors RELAY_ORIGIN', () => {
    expect(relayOrigin({ dev: true, appOrigin: 'http://localhost:5120', env: { RELAY_ORIGIN: 'http://localhost:3006' } })).toBe('http://localhost:3006')
  })
})
