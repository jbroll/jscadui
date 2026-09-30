// Single-process local server: app static + read-only /models mount + relay +
// the /api/fs file API. The compute frame is served via serveFrame on port+1.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { serveFrame } from '../../serve.js'
import { mimeOf, safeJoin } from '../static.js'
import { createFsHandler } from './fsApi.js'

export const startLocal = async ({ appDir, frameDir, modelDir, relayHandler, port }) => {
  let fsHandler = null
  const route = async (req, res) => {
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
      res.writeHead(200, { 'content-type': mimeOf(file), ...cors })
      res.end(content)
    } catch {
      res.writeHead(404, cors); res.end('not found')
    }
  }
  // An unhandled rejection would end the process, taking the page's session with it.
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(`jscad: ${req.method} ${req.url} failed:`, err)
      if (!res.headersSent) { res.writeHead(500); res.end() } else res.destroy()
    })
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const actual = server.address().port
  const origin = `http://localhost:${actual}`
  fsHandler = createFsHandler({ modelDir, appOrigin: origin })
  const frameServer = serveFrame(actual + 1, origin, frameDir)
  return { appServer: server, frameServer, url: origin }
}
