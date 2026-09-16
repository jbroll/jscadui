import http from 'http'
import fs from 'fs/promises'
import path from 'path'

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
}

// The sandboxed frame is cross-origin to its own host, so module scripts and
// the worker's bundle XHRs need CORS. The page meta carries the rest of the CSP.
const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
}

const handleStatic = async (pathname) => {
  const buildDir = path.resolve(process.cwd(), 'build')
  const filePath = path.resolve(buildDir, pathname.replace(/^\/+/, ''))
  if (!filePath.startsWith(buildDir + path.sep) && filePath !== buildDir) {
    return { status: 403, content: 'forbidden' }
  }
  const stats = await fs.stat(filePath).catch(() => undefined)
  if (!stats || !stats.isFile()) {
    return { status: 404, content: 'not found' }
  }
  const extname = path.extname(filePath)
  const contentType = mimeTypes[extname] || 'application/octet-stream'
  const content = await fs.readFile(filePath)
  return { status: 200, content, contentType }
}

const handleRequest = async (req) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname.endsWith('/')) {
    return handleStatic(pathname + 'index.html')
  }
  return handleStatic(pathname)
}

export const serve = (port, appOrigin) => {
  // frame-ancestors is ignored in a meta tag, so it must be a header. The
  // deploy vhost sets the same one in production.
  const headers = appOrigin
    ? { ...baseHeaders, 'Content-Security-Policy': `frame-ancestors ${appOrigin}` }
    : baseHeaders
  const server = http.createServer(async (req, res) => {
    let result = { status: 500, content: 'internal server error' }
    try {
      result = await handleRequest(req)
    } catch (err) {
      console.error('error handling request', err)
    }
    const { status, contentType } = result
    const { content } = result
    const outHeaders = { ...headers }
    if (contentType) outHeaders['Content-Type'] = contentType
    res.writeHead(status, outHeaders)
    res.end(content)
    const line = `${new Date().toISOString()} ${status} ${req.method} ${req.url} ${content.length}`
    if (status < 400) {
      console.log(line)
    } else {
      console.log(`\x1b[31m${line}\x1b[0m`)
    }
  })
  server.listen(port, () => {
    console.log(`jscad-studio-run on http://localhost:${port}`)
  })
}