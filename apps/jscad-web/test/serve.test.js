import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '../serve.js'

describe('serve.js', () => {
  let server
  let base

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'jscad-serve-'))
    mkdirSync(join(root, 'build'))
    writeFileSync(join(root, 'build', 'font.woff2'), 'w')
    writeFileSync(join(root, 'build', 'part.scad'), 'cube(1);')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    server = serve(0)
    await new Promise((r) => server.once('listening', r))
    base = `http://localhost:${server.address().port}`
  })

  afterAll(() => {
    server.close()
    vi.restoreAllMocks()
  })

  it('has no /remote proxy', async () => {
    const res = await fetch(`${base}/remote?url=${encodeURIComponent('https://example.com/a.js')}`)
    expect(res.status).toBe(404)
  })

  it('serves files with the shared MIME table', async () => {
    expect((await fetch(`${base}/font.woff2`)).headers.get('content-type')).toBe('font/woff2')
    expect((await fetch(`${base}/part.scad`)).headers.get('content-type')).toBe('text/plain')
  })

  it('refuses a raw path that leaves the build dir', async () => {
    const status = await new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path: '/../../etc/passwd' }, (res) => {
        res.resume()
        resolve(res.statusCode)
      }).on('error', reject)
    })
    expect(status).toBe(403)
  })
})
