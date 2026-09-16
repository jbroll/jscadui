// Builds the compute frame (apps/jscad-studio-run) and the app, then serves
// the frame on the run origin (5121) and the app on the app origin (5122).
// The frame server sends CORS headers because a sandboxed frame is
// cross-origin to its own host and module scripts and worker-bundle XHRs
// need them.
import { spawnSync } from 'child_process'
import http from 'http'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

const APP_ORIGIN = 'http://localhost:5122'
const RUN_ORIGIN = 'http://localhost:5121'
process.env.STUDIO_APP_ORIGIN = APP_ORIGIN
process.env.STUDIO_RUN_ORIGIN = RUN_ORIGIN

const build = (dir) => {
  const built = spawnSync('node', ['build.js'], { cwd: dir, stdio: 'inherit', env: process.env })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
build(join(process.cwd(), '../jscad-studio-run'))
build(process.cwd())

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
}
const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
  // frame-ancestors is ignored in a meta tag, so it must be a header.
  'Content-Security-Policy': `frame-ancestors ${APP_ORIGIN}`,
}

const serveDir = (dir) => http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
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

const runServer = serveDir(join(process.cwd(), '../jscad-studio-run/build'))
runServer.listen(5121, () => console.log(`frame on ${RUN_ORIGIN}`))

const appServer = serveDir(join(process.cwd(), 'build'))
appServer.listen(5122, () => console.log(`app on ${APP_ORIGIN}`))