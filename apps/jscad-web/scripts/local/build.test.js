// apps/jscad-web/scripts/local/build.test.js
import { describe, expect, it } from 'vitest'
import { ensureLocalBuild } from './build.js'

const setup = (marker, indexExists = true) => {
  const written = {}
  const spawned = []
  return {
    written,
    spawned,
    existsFn: (p) => (p.endsWith('index.html') ? indexExists : true),
    readMarker: () => marker,
    writeMarker: (out, m) => { written.out = out; written.marker = m },
    spawnFn: (cmd, args, opts) => {
      spawned.push({ cmd, args, env: { JSCAD_OUT_DIR: opts.env.JSCAD_OUT_DIR, FRAME_APP_ORIGIN: opts.env.FRAME_APP_ORIGIN, FRAME_RUN_ORIGIN: opts.env.FRAME_RUN_ORIGIN } })
      return 0
    },
  }
}

describe('ensureLocalBuild', () => {
  it('reuses a matching build without spawning', async () => {
    const s = setup({ appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378' })
    const out = await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(out).toBe('/w/build_local')
    expect(s.spawned).toEqual([])
  })
  it('rebuilds on port mismatch with matching origins in env', async () => {
    const s = setup({ appOrigin: 'http://localhost:5120', runOrigin: 'http://localhost:5121' })
    await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(s.spawned).toHaveLength(1)
    expect(s.spawned[0].env).toEqual({
      JSCAD_OUT_DIR: 'build_local',
      FRAME_APP_ORIGIN: 'http://localhost:7377',
      FRAME_RUN_ORIGIN: 'http://localhost:7378',
    })
    expect(s.written.marker).toEqual({ appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378' })
  })
  it('--no-build fails fast instead of building', async () => {
    const s = setup(null, false)
    await expect(ensureLocalBuild({ webDir: '/w', port: 7377, noBuild: true, ...s })).rejects.toThrow(/no matching local build/)
    expect(s.spawned).toEqual([])
  })
})
