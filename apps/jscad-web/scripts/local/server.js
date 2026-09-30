// Single-process local server: app static + read-only /models mount + relay +
// the /api/fs file API. The compute frame is served via serveFrame on port+1.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { serveFrame } from '../../serve.js'
import { createFsHandler } from './fsApi.js'

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }

const safeJoin = (root, rel) => {
  const p = resolve(join(root, rel))
  if (p !== root && !p.startsWith(root + sep)) return null
  return p
}

export const startLocal = async ({ appDir, frameDir, modelDir, relayHandler, port }) => {
  let fsHandler = null
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path.startsWith('/api/relay/')) {
      if (await relayHandler(req, res)) return
      res.writeHead(404); res.end(); return
    }
    if (path === '/api/fs' || path.startsWith('/api/fs/')) {
      if (await fsHandler(req, res)) return
      res.writeHead(404); res.end(); return
    }
    let file = null
    if (path.startsWith('/models/')) file = safeJoin(modelDir, decodeURIComponent(path.slice('/models/'.length)))
    else file = safeJoin(appDir, decodeURIComponent(path === '/' ? '/index.html' : path))
    // Errors carry CORS too, or the frame sees a NetworkError instead of the status.
    const cors = { 'access-control-allow-origin': '*' }
    if (!file) { res.writeHead(403, cors); res.end('forbidden'); return }
    try {
      const content = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', ...cors })
      res.end(content)
    } catch {
      res.writeHead(404, cors); res.end('not found')
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const actual = server.address().port
  const origin = `http://localhost:${actual}`
  fsHandler = createFsHandler({ modelDir, appOrigin: origin })
  const frameServer = serveFrame(actual + 1, origin, frameDir)
  return { appServer: server, frameServer, url: origin }
}
