// Mode-backend write-through: bytes go to the tagged backend, the version
// row and file hashes land either way.
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createSession } from '../src/storage/session.js'
import { createDiskStorage } from '../src/storage/disk.js'
import { fakeServer } from './fakeDiskServer.js'

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

  it('fails the save when the read fails for another reason, writing nothing', async () => {
    const local = createLocalStorage()
    const rowboat = {
      readProject: vi.fn(async () => {
        throw new Error('offline')
      }),
      writeFiles: vi.fn(async () => ({})),
    }
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await expect(session.writeThrough('p1', 'main.js', 'v1')).rejects.toThrow('offline')
    expect(rowboat.writeFiles).not.toHaveBeenCalled()
  })

  it('starts a project the backend has never seen', async () => {
    const local = createLocalStorage()
    const session = createSession({ local, getBackend: () => 'local' })
    await session.writeThrough('p9', 'main.js', 'v1', { entry: 'main.js' })
    expect((await local.readProject('p9')).files).toEqual({ 'main.js': 'v1' })
  })

  it('removes a file through the tagged backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await local.writeFiles('p1', { 'main.js': 'm', 'gone.js': 'g' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: () => 'local' })
    await session.removeThrough('p1', 'gone.js')
    expect((await local.readProject('p1')).files).toEqual({ 'main.js': 'm' })
  })

  it('removes through rowboat when the mode says so', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await rowboat.writeFiles('p1', { 'main.js': 'm', 'gone.js': 'g' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.removeThrough('p1', 'gone.js')
    expect((await rowboat.readProject('p1')).files).toEqual({ 'main.js': 'm' })
  })

  it('falls back to a fresh project on a typed rowboat not-found', async () => {
    const local = createLocalStorage()
    const rowboat = {
      readProject: vi.fn(async () => {
        throw Object.assign(new Error('projects: not found (p1)'), { name: 'NotFoundError' })
      }),
      writeFiles: vi.fn(async () => ({})),
    }
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.writeThrough('p1', 'main.js', 'v1')
    expect(rowboat.writeFiles).toHaveBeenCalledWith('p1', { 'main.js': 'v1' }, {})
  })

  it('names a missing project NotFoundError', async () => {
    const local = createLocalStorage()
    await expect(local.readProject('nope')).rejects.toMatchObject({ name: 'NotFoundError', message: 'projects: not found (nope)' })
    await expect(local.snapshot('nope')).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it("snapshots a project's stored files as a version in its backend", async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await rowboat.writeFiles('p1', { 'main.js': 'v0' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.writeThrough('p1', 'main.js', 'v1', { message: 'chat', version: false })
    await session.snapshot('p1', { message: 'chat' })
    expect((await rowboat.listVersions('p1')).map((v) => v.message)).toEqual(['chat', ''])
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

  it('routes a conversation through the project mode backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const session = createSession({ local, getRowboat: () => rowboat, getBackend: () => 'rowboat' })
    await session.writeConversation('p1', [{ role: 'user', content: 'hi' }])
    expect((await rowboat.readConversation('p1')).messages).toEqual([{ role: 'user', content: 'hi' }])
    expect((await session.readConversation('p1')).messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('falls back to local when the rowboat backend is unavailable', async () => {
    const local = createLocalStorage()
    const session = createSession({ local, getRowboat: () => null, getBackend: () => 'rowboat' })
    await session.writeConversation('p2', [{ role: 'user', content: 'x' }])
    expect((await local.readConversation('p2')).messages).toEqual([{ role: 'user', content: 'x' }])
  })
})

describe('disk mode', () => {
  const withDisk = () => {
    const local = createLocalStorage()
    const server = fakeServer({ 'main.js': 'm' })
    const disk = createDiskStorage({ fetch: server.fetch, EventSource: server.EventSource })
    const session = createSession({ local, disk, getBackend: (projectId) => (projectId === 'disk' ? 'disk' : 'local') })
    return { local, server, session }
  }

  it('writes a disk project into the directory and nowhere else', async () => {
    const { local, server, session } = withDisk()
    await session.writeThrough('disk', 'lib/part.js', 'p', { message: 'chat', version: false })
    expect(server.puts()).toEqual(['/api/fs/lib/part.js'])
    expect(server.text('lib/part.js')).toBe('p')
    expect(await local.listProjects()).toEqual([])
  })

  it('reads through the directory', async () => {
    const { session } = withDisk()
    expect(await session.readThrough('disk', 'main.js')).toBe('m')
  })

  it("snapshots nothing: the directory's git keeps history", async () => {
    const { server, session } = withDisk()
    server.clear()
    await expect(session.snapshot('disk', { message: 'chat' })).resolves.toBeUndefined()
    expect(server.requests).toEqual([])
  })
})

const withDiskForUnique = () => {
  const local = createLocalStorage()
  const server = fakeServer({ 'main.js': 'm' })
  const disk = createDiskStorage({ fetch: server.fetch, EventSource: server.EventSource })
  const session = createSession({ local, disk, getBackend: (projectId) => (projectId === 'disk' ? 'disk' : 'local') })
  return { local, server, session }
}

describe('snapshotUnique routing', () => {
  it('snapshots a unique version then skips the identical one', async () => {
    const local = createLocalStorage()
    const session = createSession({ local, getBackend: () => 'local' })
    await local.writeFiles('p1', { 'main.js': 'v1' }, { message: 'create', name: 'P', entry: 'main.js' })
    await session.writeThrough('p1', 'main.js', 'v2', { message: 'edit', version: false })

    expect(await session.snapshotUnique('p1', { message: 'edit' })).toBe(true)
    expect(await session.snapshotUnique('p1', { message: 'edit' })).toBe(false)
    expect((await local.listVersions('p1')).map((v) => v.message)).toEqual(['edit', 'create'])
  })

  it('routes through the project mode backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await rowboat.writeFiles('p1', { 'main.js': 'v1' }, { message: 'edit', entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })

    expect(await session.snapshotUnique('p1', { message: 'edit' })).toBe(false)
    expect((await rowboat.listVersions('p1')).map((v) => v.message)).toEqual(['edit'])
    expect(await local.listVersions('p1')).toEqual([])
  })

  it('snapshots nothing uniquely in disk mode', async () => {
    const { server, session } = withDiskForUnique()
    server.clear()
    await expect(session.snapshotUnique('disk', { message: 'edit' })).resolves.toBe(false)
    expect(server.requests).toEqual([])
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
