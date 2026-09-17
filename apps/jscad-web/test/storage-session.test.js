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

  it('writes a rowboat path to the rowboat backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.writeThrough('p1', 'lib/gear.js', 'gear', { message: 'edit', name: 'P', entry: 'main.js' })
    expect((await rowboat.readProject('p1')).files['lib/gear.js']).toBe('gear')
  })

  it('reads through the tagged backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await local.writeFiles('p1', { 'main.js': 'local-main' }, { entry: 'main.js' })
    await rowboat.writeFiles('p1', { 'lib/gear.js': 'rowboat-gear' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: (path) => (path === 'main.js' ? 'local' : 'rowboat') })
    expect(await session.readThrough('p1', 'main.js')).toBe('local-main')
    expect(await session.readThrough('p1', 'lib/gear.js')).toBe('rowboat-gear')
  })
})
