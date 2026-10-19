import { EventEmitter } from 'node:events'
import net from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { startLauncher } from './launcher.js'

const listen = (port = 0) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.listen(port, '127.0.0.1', () => resolve(server))
  })

const close = (server) => new Promise((resolve) => server.close(resolve))

const freePort = async () => {
  const server = await listen()
  const { port } = server.address()
  await close(server)
  return port
}

const fakeChild = ({ stdout = '', stderr = '', exitCode = null } = {}) => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = []
  const exit = (code, signal) => {
    child.stdout.end()
    child.stderr.end()
    setTimeout(() => {
      child.emit('exit', code, signal)
      child.emit('close', code, signal)
    }, 10)
  }
  child.kill = (signal = 'SIGTERM') => {
    child.killed.push(signal)
    exit(null, signal)
    return true
  }
  setImmediate(() => {
    if (stdout) child.stdout.write(stdout)
    if (stderr) child.stderr.write(stderr)
    if (exitCode !== null) exit(exitCode, null)
  })
  return child
}

const opts = { modelDir: '/tmp/model', logDir: '/tmp/logs', webDir: '/w' }

describe('startLauncher', () => {
  let server
  afterEach(async () => {
    if (server) await close(server)
    server = null
  })

  it('rejects when the port is in use', async () => {
    server = await listen()
    const { port } = server.address()
    const spawnImpl = () => {
      throw new Error('spawned on a busy port')
    }
    await expect(startLauncher({ ...opts, port, spawnImpl })).rejects.toThrow(`port ${port} is in use`)
  })

  it('rejects with stderr tail when the process exits early', async () => {
    const port = await freePort()
    const spawnImpl = () => fakeChild({ stderr: 'boom\n', exitCode: 1 })
    await expect(startLauncher({ ...opts, port, spawnImpl })).rejects.toThrow(/exited with code 1[\s\S]*boom/)
  })

  it('resolves the page url from the launcher line and stops the process', async () => {
    const port = await freePort()
    const calls = []
    let child
    const spawnImpl = (cmd, args, options) => {
      calls.push({ cmd, args, options })
      child = fakeChild({ stdout: `jscad: /tmp/model → http://localhost:${port}/#/models/main.js  (frame :${port + 1})\n` })
      return child
    }
    const launcher = await startLauncher({ ...opts, port, spawnImpl })
    expect(launcher.url).toBe(`http://localhost:${port}/#/models/main.js`)
    expect(calls[0].args).toEqual(['scripts/jscad.mjs', '/tmp/model', '--port', String(port), '--no-open'])
    expect(calls[0].options.cwd).toBe('/w')
    expect(calls[0].options.env).toMatchObject({ JSCAD_TRACKED: '1', JSCAD_CHAT_LOG: '/tmp/logs' })
    await launcher.stop()
    expect(child.killed).toEqual(['SIGTERM'])
  })
})
