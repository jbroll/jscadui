// Single-process local server: app static + read-only /models mount + relay +
// the /api/fs file API. The compute frame is served via serveFrame on port+1.
import http from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { serveFrame } from '../../serve.js'
import { mimeOf, safeJoin } from '../static.js'
import { appHosts, createFsHandler, fromApp, hiddenSegment, resolvesInside } from './fsApi.js'

export const startLocal = async ({ appDir, frameDir, modelDir, relayHandler, port }) => {
  let fsHandler = null
  let appOrigin = ''
  let hosts = new Set()
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
    if (path.startsWith('/models/')) {
      if (!fromApp(req, appOrigin, hosts)) { res.writeHead(403); res.end('untrusted origin'); return }
      const segments = decodeURIComponent(path.slice('/models/'.length)).split(/[/\\]/)
      if (segments.some((s) => hiddenSegment(s) || s === '')) { res.writeHead(404); res.end('not found'); return }
      // modelDir may itself be reached through a symlink (macOS /var → /private/var);
      // resolvesInside compares realpaths, so resolve the root once and use it for
      // both the join and the containment check, like /api/fs's realRoot().
      const root = await realpath(modelDir)
      const joined = safeJoin(root, segments.join('/'))
      if (!joined || !(await resolvesInside(root, joined))) { res.writeHead(404); res.end('not found'); return }
      file = joined
    } else {
      file = safeJoin(appDir, decodeURIComponent(path === '/' ? '/index.html' : path))
    }
    // The frame reads the app's own assets cross-origin, errors included, and
    // needs CORS to see the status; /models/ is app-only and carries none.
    const cors = path.startsWith('/models/') ? {} : { 'access-control-allow-origin': '*' }
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
  let frameServer
  // The frame must sit on appPort + 1 (the app derives its origin that way), but
  // that port can be a concurrent server's in this process or another; a fresh
  // ephemeral app port is retried until the pair is free, rather than letting an
  // unhandled EADDRINUSE take the process down.
  for (;;) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const actual = server.address().port
    const origin = `http://localhost:${actual}`
    try {
      frameServer = await new Promise((resolve, reject) => {
        const frame = serveFrame(actual + 1, origin, frameDir)
        frame.once('error', reject)
        frame.once('listening', () => {
          frame.off('error', reject)
          resolve(frame)
        })
      })
      appOrigin = origin
      break
    } catch (error) {
      await new Promise((resolve) => server.close(resolve))
      if (error.code !== 'EADDRINUSE') throw error
    }
  }
  hosts = appHosts(appOrigin)
  fsHandler = createFsHandler({ modelDir, appOrigin })
  return { appServer: server, frameServer, url: appOrigin }
}
