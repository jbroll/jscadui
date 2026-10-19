// Starts the local launcher (scripts/jscad.mjs) on one model directory for one
// synthetic session, with its relay logging to the batch directory.
import { spawn } from 'node:child_process'
import net from 'node:net'

export const LAUNCH_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 5_000
const TAIL_LINES = 20
const READY = /^jscad: .* → (http:\/\/\S+)/

// Each lane port gets its own build: the bundle bakes the app and frame origins.
export const laneBuildName = (port) => `build_local-${port}`

const portFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })

const lineReader = (stream, onLine) => {
  let partial = ''
  stream.setEncoding?.('utf8')
  stream.on('data', (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop()
    for (const line of lines) onLine(line)
  })
  stream.on('end', () => {
    if (partial) onLine(partial)
    partial = ''
  })
}

export async function startLauncher({ modelDir, port, logDir, webDir, outName = laneBuildName(port), timeoutMs = LAUNCH_TIMEOUT_MS, spawnImpl = spawn }) {
  // The app needs `port`, the frame `port + 1`.
  for (const p of [port, port + 1]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is in use`)
  }
  const child = spawnImpl(process.execPath, ['scripts/jscad.mjs', modelDir, '--port', String(port), '--no-open'], {
    cwd: webDir,
    env: { ...process.env, JSCAD_TRACKED: '1', JSCAD_CHAT_LOG: logDir, JSCAD_LOCAL_OUT: outName },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr = []
  lineReader(child.stderr, (line) => {
    stderr.push(line)
    if (stderr.length > TAIL_LINES) stderr.shift()
  })
  const tail = () => stderr.join('\n')

  let exited = false
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    exited = true
    resolve({ code, signal })
  }))

  const stop = async () => {
    if (exited) return
    child.kill('SIGTERM')
    const grace = new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS, 'grace'))
    if ((await Promise.race([closed, grace])) === 'grace') {
      child.kill('SIGKILL')
      await closed
    }
  }

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`launcher did not start within ${timeoutMs / 1000} s:\n${tail()}`))
    }, timeoutMs)
    lineReader(child.stdout, (line) => {
      const match = READY.exec(line)
      if (!match) return
      clearTimeout(timer)
      resolve(match[1])
    })
    closed.then(({ code, signal }) => {
      clearTimeout(timer)
      reject(new Error(`launcher exited with ${code === null ? `signal ${signal}` : `code ${code}`}:\n${tail()}`))
    })
  }).catch(async (e) => {
    await stop()
    throw e
  })
  return { url, stop }
}
