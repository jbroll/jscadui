import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import zlib from 'zlib'
import { DEFAULT_MIME, mimeOf, safeJoin } from './scripts/static.js'

/**
 * Route an http request
 */
const handleRequest = (req) => {
  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname

  if (pathname === '/docs') {
    // docs redirect
    return { status: 301, content: '/docs/' }
  } else if (pathname.endsWith('/index.html')) {
    // redirect index.html to /
    return { status: 301, content: pathname.slice(0, -10) }
  } else if (pathname.endsWith('/')) {
    // serve index.html
    return handleStatic(`${pathname}index.html`)
  } else {
    // serve static files
    return handleStatic(pathname)
  }
}

/**
 * Serve static file from the build directory
 */
const handleStatic = async (pathname) => {
  const filePath = safeJoin(path.resolve(process.cwd(), 'build'), pathname)

  // The frame's opaque origin reads examples and model files from here, and
  // every such read is a cross-origin fetch, errors included.
  const headers = { 'Access-Control-Allow-Origin': '*' }

  if (!filePath) {
    return { status: 403, content: 'forbidden', headers }
  }

  const stats = await fs.stat(filePath).catch(() => undefined)
  if (!stats || !stats.isFile()) {
    return { status: 404, content: 'not found', headers }
  }

  const contentType = mimeOf(filePath)
  if (contentType === DEFAULT_MIME) {
    console.error(`serving unknown mimetype ${path.extname(filePath)}`)
  }

  const content = await fs.readFile(filePath)
  return { status: 200, content, contentType, headers }
}

/**
 * Serve the compute frame from frameDir, rooted at this server's own origin,
 * without the SPA fallback. The frame is now a different origin than the
 * app, so frame-ancestors must name the app origin explicitly — 'self'
 * would match only this server's own origin.
 */
const handleFrame = async (pathname, frameDir, appOrigin) => {
  const filePath = safeJoin(path.resolve(process.cwd(), frameDir), pathname)
  const cors = { 'Access-Control-Allow-Origin': '*' }
  if (!filePath) {
    return { status: 403, content: 'forbidden', headers: cors }
  }
  const stats = await fs.stat(filePath).catch(() => undefined)
  if (!stats || !stats.isFile()) {
    return { status: 404, content: 'not found', headers: cors }
  }
  const contentType = mimeOf(filePath)
  const content = await fs.readFile(filePath)
  const headers = {
    ...cors,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
    'Content-Security-Policy': `frame-ancestors ${appOrigin}`,
  }
  return { status: 200, content, contentType, headers }
}

/**
 * Serve the compute frame on its own origin/port, from frameDir
 * (build/frame or build_dev/frame, matching the build that made it).
 */
export const serveFrame = (port, appOrigin, frameDir = 'build/frame') => {
  const server = http.createServer(async (req, res) => {
    const pathname = url.parse(req.url, true).pathname
    const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const { status, content, contentType, headers } = await handleFrame(rel, frameDir, appOrigin)
    res.writeHead(status, { ...headers, ...(contentType ? { 'Content-Type': contentType } : {}) })
    res.end(content)
  })
  server.listen(port)
  console.log(`compute frame on http://localhost:${port}`)
  return server
}

/* create http server */
const server = http.createServer(async (req, res) => {
  const startTime = new Date()

  // handle request
  let result = { status: 500, content: 'internal server error' }
  try {
    result = await handleRequest(req)
  } catch (err) {
    console.error('error handling request', err)
  }
  const { status, contentType } = result
  let { content } = result

  // write http header
  const headers = { 'Connection': 'keep-alive', ...(result.headers ?? {}) }
  if (contentType) headers['Content-Type'] = contentType
  if (status === 301) {
    // handle redirect
    headers['Location'] = content
    content = ''
  }
  // compress content
  const gzipped = gzip(req, content)
  if (gzipped) {
    headers['Content-Encoding'] = 'gzip'
    content = gzipped
  }
  res.writeHead(status, headers)
  // write http response
  res.end(content)

  // log request
  const endTime = new Date()
  const ms = endTime - startTime
  const line = `${endTime.toISOString()} ${status} ${req.method} ${req.url} ${content.length} ${ms}ms`
  if (status < 400) {
    console.log(line)
  } else {
    // highlight errors red
    console.log(`\x1b[31m${line}\x1b[0m`)
  }
})

/**
 * Start http server on given port
 */
export const serve = (port) => server.listen(port, () => {
  console.log(`JSCADUI running on http://localhost:${server.address().port}`)
})

/**
 * If the request accepts gzip, compress the content, else undefined
 */
const gzip = (req, content) => {
  if (!content) return undefined
  const acceptEncoding = req.headers['accept-encoding']
  if (acceptEncoding?.includes('gzip')) {
    return zlib.gzipSync(content)
  }
}
