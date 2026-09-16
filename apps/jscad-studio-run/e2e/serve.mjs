// Builds the frame for the e2e origins, then serves the frame on the run
// origin (5121), the host page on the app origin (5122), and the wrong-origin
// sender on a third origin (5123). The frame server sends CORS headers because
// a sandboxed frame is cross-origin to its own host and module scripts and
// worker-bundle XHRs need them.
import { spawnSync } from 'child_process'
import http from 'http'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

const APP_ORIGIN = 'http://localhost:5122'
const RUN_ORIGIN = 'http://localhost:5121'
const ATTACK_ORIGIN = 'http://localhost:5123'
process.env.STUDIO_APP_ORIGIN = APP_ORIGIN
process.env.STUDIO_RUN_ORIGIN = RUN_ORIGIN
const built = spawnSync('node', ['build.js'], { stdio: 'inherit', env: process.env })
if (built.status !== 0) process.exit(built.status ?? 1)

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}
const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
  // frame-ancestors is ignored in a meta tag, so it must be a header.
  'Content-Security-Policy': `frame-ancestors ${APP_ORIGIN}`,
}

// The wrong-origin test proves the frame rejected a command by its side effect:
// a model that reaches the run origin marks the hit here, where the test reads
// it. A response cannot prove it, because the frame answers with targetOrigin =
// app origin and the browser drops it for any other sender.
let markHits = 0

const serveFile = (dir) => http.createServer(async (req, res) => {
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
  const file = pathname.endsWith('/') ? join(dir, 'index.html') : join(dir, pathname)
  try {
    const content = await readFile(file)
    res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404, COMMON_HEADERS)
    res.end('not found')
  }
})

const serveHost = () => http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/host.html') {
    const content = await readFile(join(process.cwd(), 'e2e', 'host.html'))
    res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/html' })
    res.end(content)
    return
  }
  // The frame's fetch test targets this. It is reachable from the app origin,
  // so a model that got through would return data instead of a model error.
  if (pathname === '/api/private') {
    res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ secret: true }))
    return
  }
  res.writeHead(404, COMMON_HEADERS)
  res.end('not found')
})

const serveAttacker = () => http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/' || pathname === '/wrong.html') {
    const content = await readFile(join(process.cwd(), 'e2e', 'wrong.html'))
    res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/html' })
    res.end(content)
    return
  }
  res.writeHead(404, COMMON_HEADERS)
  res.end('not found')
})

const frameServer = serveFile(join(process.cwd(), 'build'))
frameServer.listen(5121, () => console.log(`frame on ${RUN_ORIGIN}`))

const hostServer = serveHost()
hostServer.listen(5122, () => console.log(`host on ${APP_ORIGIN}`))

const attackerServer = serveAttacker()
attackerServer.listen(5123, () => console.log(`attacker on ${ATTACK_ORIGIN}`))
