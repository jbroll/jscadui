// Builds the frame for the e2e origins, then serves the frame on the run
// origin (5121) and the host pages on the app origin (5122). The frame server
// sends CORS headers because a sandboxed frame is cross-origin to its own host
// and module scripts and worker-bundle XHRs need them.
import { spawnSync } from 'child_process'
import http from 'http'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

process.env.STUDIO_APP_ORIGIN = 'http://localhost:5122'
process.env.STUDIO_RUN_ORIGIN = 'http://localhost:5121'
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
}

const serveFile = (dir) => http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (pathname === '/wrong.html') {
    const content = await readFile(join(process.cwd(), 'e2e', 'wrong.html'))
    res.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/html' })
    res.end(content)
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

const frameServer = serveFile(join(process.cwd(), 'build'))
frameServer.listen(5121, () => console.log('frame on http://localhost:5121'))

const hostServer = serveHost()
hostServer.listen(5122, () => console.log('host on http://localhost:5122'))