// Mode-backend write-through: bytes go to the tagged backend, the version
// row and file hashes land either way.
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createSession } from '../src/storage/session.js'

describe('mode write-through', () => {
  it('writes a local path to the local backend and versions it', async () => {
    const local = createLocalStorage()
    const rowboat = { writeFiles: vi.fn(async () => ({})), readProject: vi.fn() }
    const session = createSession({ local, rowboat, getBackend: () => 'local' })
    await session.writeThrough('p1', 'main.js', 'v1', { message: 'edit', name: 'P', entry: 'main.js' })
    expect((await local.readProject('p1')).files['main.js']).toBe('v1')
    expect(rowboat.writeFiles).not.toHaveBeenCalled()
    expect(await local.listVersions('p1')).toHaveLength(1)
  })

  it('writes to the rowboat backend when the mode says so', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.writeThrough('p1', 'lib/gear.js', 'gear', { message: 'edit', name: 'P', entry: 'main.js' })
    expect((await rowboat.readProject('p1')).files['lib/gear.js']).toBe('gear')
  })

  it('reads through the tagged backend per project', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await local.writeFiles('p1', { 'main.js': 'local-main' }, { entry: 'main.js' })
    await rowboat.writeFiles('p2', { 'main.js': 'rowboat-main' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: (projectId) => (projectId === 'p1' ? 'local' : 'rowboat') })
    expect(await session.readThrough('p1', 'main.js')).toBe('local-main')
    expect(await session.readThrough('p2', 'main.js')).toBe('rowboat-main')
  })
})

describe('rowboat attach and per-project modes', () => {
  it('routes to rowboat once attached and the mode says so', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    let attached = null
    const modes = new Map([['p1', 'local']])
    const session = createSession({
      local,
      getRowboat: () => attached,
      getBackend: (projectId) => modes.get(projectId) ?? 'local',
    })
    await session.writeThrough('p1', 'main.js', 'v1', { entry: 'main.js' })
    expect((await local.readProject('p1')).files['main.js']).toBe('v1')
    attached = rowboat
    modes.set('p1', 'rowboat')
    await session.writeThrough('p1', 'main.js', 'v2', { entry: 'main.js' })
    expect((await rowboat.readProject('p1')).files['main.js']).toBe('v2')
  })
})
