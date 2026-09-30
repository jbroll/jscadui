// apps/jscad-web/scripts/local/build.test.js
import { describe, expect, it } from 'vitest'
import { ensureLocalBuild, sourceStamp } from './build.js'

const gitStub = (outputs) => (_cmd, args) => {
  const out = outputs[args.slice(2).join(' ')]
  return out === undefined ? { status: 128, stdout: '' } : { status: 0, stdout: out }
}

describe('sourceStamp', () => {
  const clean = { 'rev-parse HEAD': 'abc123\n', 'diff HEAD': '', 'ls-files --others --exclude-standard': '' }
  it('is the HEAD commit for a clean tree', () => {
    expect(sourceStamp('/w', gitStub(clean))).toBe('abc123')
  })
  it('adds a hash of uncommitted changes', () => {
    const edited = sourceStamp('/w', gitStub({ ...clean, 'diff HEAD': '+a\n' }))
    const editedMore = sourceStamp('/w', gitStub({ ...clean, 'diff HEAD': '+b\n' }))
    const added = sourceStamp('/w', gitStub({ ...clean, 'ls-files --others --exclude-standard': 'new.js\n' }))
    expect(edited).toMatch(/^abc123\+[0-9a-f]{12}$/)
    expect(new Set([edited, editedMore, added]).size).toBe(3)
  })
  it('is null outside a git checkout', () => {
    expect(sourceStamp('/w', gitStub({}))).toBeNull()
  })
})

const origins = { appOrigin: 'http://localhost:7377', runOrigin: 'http://localhost:7378' }

const setup = (marker, indexExists = true, stamp = 'abc123') => {
  const written = {}
  const spawned = []
  return {
    written,
    spawned,
    sourceStamp: () => stamp,
    existsFn: (p) => (p.endsWith('index.html') ? indexExists : true),
    readMarker: () => marker,
    writeMarker: (out, m) => { written.out = out; written.marker = m },
    spawnFn: (cmd, args, opts) => {
      spawned.push({ cmd, args, env: { JSCAD_OUT_DIR: opts.env.JSCAD_OUT_DIR, FRAME_APP_ORIGIN: opts.env.FRAME_APP_ORIGIN, FRAME_RUN_ORIGIN: opts.env.FRAME_RUN_ORIGIN, JSCAD_LOCAL_FS: opts.env.JSCAD_LOCAL_FS } })
      return 0
    },
  }
}

describe('ensureLocalBuild', () => {
  it('reuses a build with matching ports and source without spawning', async () => {
    const s = setup({ ...origins, source: 'abc123' })
    const out = await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(out).toBe('/w/build_local')
    expect(s.spawned).toEqual([])
  })
  it('rebuilds when the source changed since the build', async () => {
    const s = setup({ ...origins, source: 'old999' })
    await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(s.spawned).toHaveLength(1)
    expect(s.written.marker).toEqual({ ...origins, source: 'abc123' })
  })
  it('rebuilds a build from before source stamps', async () => {
    const s = setup(origins)
    await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(s.spawned).toHaveLength(1)
  })
  it('reuses a build outside git when the ports match', async () => {
    const s = setup({ ...origins, source: null }, true, null)
    await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(s.spawned).toEqual([])
  })
  it('rebuilds on port mismatch with matching origins in env', async () => {
    const s = setup({ appOrigin: 'http://localhost:5120', runOrigin: 'http://localhost:5121', source: 'abc123' })
    await ensureLocalBuild({ webDir: '/w', port: 7377, ...s })
    expect(s.spawned).toHaveLength(1)
    expect(s.spawned[0].env).toEqual({
      JSCAD_OUT_DIR: 'build_local',
      FRAME_APP_ORIGIN: 'http://localhost:7377',
      FRAME_RUN_ORIGIN: 'http://localhost:7378',
      JSCAD_LOCAL_FS: '1',
    })
    expect(s.written.marker).toEqual({ ...origins, source: 'abc123' })
  })
  it('--no-build fails fast instead of building', async () => {
    const s = setup(null, false)
    await expect(ensureLocalBuild({ webDir: '/w', port: 7377, noBuild: true, ...s })).rejects.toThrow(/no matching local build/)
    expect(s.spawned).toEqual([])
  })
})
