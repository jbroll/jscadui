import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fillFrameHtml } from '../src_build/frameHtml.js'

const template = readFileSync(fileURLToPath(new URL('../static/frame/index.html', import.meta.url)), 'utf-8')
const connectSrc = (html) => html.match(/content="[^"]*connect-src ([^;]*);/)[1].trim().split(/\s+/)

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

  it('opens plain-http localhost only for a dev build', () => {
    const html = fillFrameHtml(template, { appOrigin: 'http://localhost:5120', runOrigin: 'http://localhost:5121', dev: true })
    expect(connectSrc(html)).toContain('http://localhost:*')
  })

  it('leaves no placeholder behind', () => {
    const html = fillFrameHtml(template, { appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378', dev: false })
    expect(html).not.toMatch(/__[A-Z_]+__/)
  })
})
