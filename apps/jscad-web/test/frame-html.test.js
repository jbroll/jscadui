import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fillFrameHtml, fillHtmlOrigins } from '../src_build/frameHtml.js'

const template = readFileSync(fileURLToPath(new URL('../static/frame/index.html', import.meta.url)), 'utf-8')
const appTemplate = readFileSync(fileURLToPath(new URL('../static/index.html', import.meta.url)), 'utf-8')
const connectSrc = (html) => html.match(/content="[^"]*connect-src ([^;]*);/)[1].trim().split(/\s+/)
const appDirective = (html, name) => {
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]*)"/s)[1]
  return csp.match(new RegExp(`(?:^|; )${name} ([^;]*)`))[1].trim().split(/\s+/)
}

describe('fillFrameHtml', () => {
  it('lets a production build with an http app origin read from the app origin', () => {
    const html = fillFrameHtml(template, { appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378', dev: false })
    expect(connectSrc(html)).toContain('http://localhost:7377')
    expect(connectSrc(html)).not.toContain('http://localhost:*')
  })

  it('names the deployed app and run origins', () => {
    const html = fillFrameHtml(template, { appOrigin: 'https://jscad.rkroll.com', runOrigin: 'https://jscad-run.rkroll.com', dev: false })
    expect(connectSrc(html)).toEqual(['https:', 'https://jscad-run.rkroll.com', 'https://jscad.rkroll.com'])
    expect(html).toContain('frame-ancestors https://jscad.rkroll.com')
  })

  it('opens plain-http loopback only for a dev build', () => {
    const html = fillFrameHtml(template, { appOrigin: 'http://localhost:5120', runOrigin: 'http://localhost:5121', dev: true })
    // The e2e stub relays listen on 127.0.0.1, a different host from the app's localhost.
    expect(connectSrc(html)).toEqual(expect.arrayContaining(['http://localhost:*', 'http://127.0.0.1:*']))
  })

  it('leaves no placeholder behind', () => {
    const html = fillFrameHtml(template, { appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378', dev: false })
    expect(html).not.toMatch(/__[A-Z_]+__/)
  })

  it('does not carry the retired jscad studio title', () => {
    const html = fillFrameHtml(template, { appOrigin: 'https://jscad.rkroll.com', runOrigin: 'https://jscad-run.rkroll.com', dev: false })
    expect(html).not.toContain('jscad studio compute frame')
    expect(html).toContain('<title>jscad compute frame</title>')
  })
})

describe('fillHtmlOrigins (app shell)', () => {
  it('names the build origins and ships no localhost in a production build', () => {
    const html = fillHtmlOrigins(appTemplate, {
      appOrigin: 'https://jscad.rkroll.com',
      runOrigin: 'https://jscad-run.rkroll.com',
      relayOrigin: 'https://jscad.rkroll.com',
      dev: false,
    })
    expect(appDirective(html, 'frame-src')).toEqual(['https://jscad-run.rkroll.com'])
    expect(appDirective(html, 'connect-src')).toContain('https://jscad.rkroll.com')
    expect(html).not.toContain('localhost')
    expect(html).not.toContain('127.0.0.1')
    expect(html).not.toMatch(/__[A-Z_]+__/)
  })

  it('opens plain-http loopback only for a dev build', () => {
    const html = fillHtmlOrigins(appTemplate, {
      appOrigin: 'http://localhost:5120',
      runOrigin: 'http://localhost:5121',
      relayOrigin: 'https://jscad.rkroll.com',
      dev: true,
    })
    expect(appDirective(html, 'frame-src')).toEqual(['http://localhost:5121', 'http://localhost:*', 'http://127.0.0.1:*'])
    // The e2e stub relays listen on 127.0.0.1, a different host from the app's localhost.
    expect(appDirective(html, 'connect-src')).toEqual(expect.arrayContaining(['http://localhost:*', 'http://127.0.0.1:*']))
  })
})
