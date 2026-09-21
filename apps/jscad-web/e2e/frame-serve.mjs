// Frame e2e micro-servers: the frame itself comes from its own dev server
// (http://localhost:5121/, started by the playwright webServer or
// ci/render). This module serves only what that server must not:
//   5122 — the marker origin: __mark (a command that ran is observable even
//           though its reply is dropped for a wrong-origin sender), __whoami
//           (what authority a model's fetch carried) and __no-cors.
//   5123 — frame-wrong.html, the attacker origin. frame-ancestors names the
//           app origin, so this origin can't embed the frame; the
//           wrong-origin test proves the frame also never answers it.
import http from 'node:http'
import { readFile } from 'node:fs/promises'

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
}

let markHits = 0
let lastWhoami = null
let servers = []

const listen = (server, port) =>
  new Promise((resolve) => server.listen(port, () => resolve(server)))

export const startServers = async () => {
  const api = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/__mark') {
      markHits++
      res.writeHead(200, COMMON_HEADERS)
      res.end('ok')
      return
    }
    if (pathname === '/__mark-count') {
      res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ count: markHits }))
      return
    }
    if (pathname === '/__mark-reset') {
      markHits = 0
      res.writeHead(200, COMMON_HEADERS)
      res.end('ok')
      return
    }
    // Records what authority the caller carried. The model cannot read a
    // credentialed response back (CORS forbids it against a wildcard), so the
    // test reads the observation from the server instead.
    if (pathname === '/__whoami') {
      lastWhoami = { cookie: req.headers.cookie ?? null, origin: req.headers.origin ?? null }
      res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(lastWhoami))
      return
    }
    if (pathname === '/__whoami-last') {
      res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(lastWhoami))
      return
    }
    // Deliberately no Access-Control-Allow-Origin: CORS, not CSP, is what now
    // keeps a model from reading a response it has no business reading.
    if (pathname === '/__no-cors') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ secret: true }))
      return
    }
    res.writeHead(404, COMMON_HEADERS)
    res.end('not found')
  })
  const attacker = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/' || pathname === '/frame-wrong.html') {
      const content = await readFile(new URL('./frame-wrong.html', import.meta.url))
      res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/html' })
      res.end(content)
      return
    }
    res.writeHead(404, COMMON_HEADERS)
    res.end('not found')
  })
  servers = [await listen(api, 5122), await listen(attacker, 5123)]
}

export const stopServers = async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))))
  servers = []
}
