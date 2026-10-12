// Storage interface contract against the fake local backend: every mode
// implements the same shape, so the editor and chat can swap backends.
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'

const MAIN = 'const gear = { teeth: 12 }'

describe('storage interface (local backend)', () => {
  it('writes files then reads them back with kind derived from entry', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p1', { 'main.js': MAIN }, { message: 'first', name: 'Gear', entry: 'main.js' })
    const project = await store.readProject('p1')
    expect(project.files).toEqual({ 'main.js': MAIN })
    expect(project.kind).toBe('jscad')
    expect(project.mode).toBe('local')
  })

  it('derives openscad kind from a .scad entry', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p2', { 'part.scad': 'cube(5);' }, { name: 'Bracket', entry: 'part.scad' })
    expect((await store.readProject('p2')).kind).toBe('openscad')
  })

  it('writes one version row per write and lists them newest first', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p3', { 'main.js': 'v1' }, { message: 'one', name: 'P3', entry: 'main.js' })
    await store.writeFiles('p3', { 'main.js': 'v2' }, { message: 'two' })
    const versions = await store.listVersions('p3')
    expect(versions).toHaveLength(2)
    expect(versions.map((v) => v.message)).toEqual(['two', 'one'])
    const latest = await store.readVersion('p3', versions[0].versionId)
    expect(latest.files).toEqual({ 'main.js': 'v2' })
  })

  it('writes without a version row when asked, and snapshots the stored files as one', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p4', { 'main.js': 'v1' }, { message: 'create', name: 'P4', entry: 'main.js' })
    await store.writeFiles('p4', { 'main.js': 'v2', 'lib.js': 'l' }, { message: 'chat', version: false })
    expect((await store.readProject('p4')).files).toEqual({ 'main.js': 'v2', 'lib.js': 'l' })
    expect((await store.listVersions('p4')).map((v) => v.message)).toEqual(['create'])
    await store.snapshot('p4', { message: 'chat' })
    const versions = await store.listVersions('p4')
    expect(versions.map((v) => v.message)).toEqual(['chat', 'create'])
    expect(await store.readVersion('p4', versions[0].versionId)).toEqual({ files: { 'main.js': 'v2', 'lib.js': 'l' }, entry: 'main.js' })
  })

  it('stores a conversation per project and returns null when absent', async () => {
    const store = createLocalStorage()
    expect(await store.readConversation('missing')).toBeNull()
    const messages = [{ role: 'user', content: 'make a gear' }]
    await store.writeConversation('p4', messages)
    const resumed = await store.readConversation('p4')
    expect(resumed.messages).toEqual(messages)
  })

  it('lists projects newest first', async () => {
    const store = createLocalStorage()
    await store.writeFiles('a', { 'main.js': 'a' }, { name: 'A', entry: 'main.js' })
    await store.writeFiles('b', { 'main.js': 'b' }, { name: 'B', entry: 'main.js' })
    const ids = (await store.listProjects()).map((p) => p.id)
    expect(ids).toEqual(['b', 'a'])
  })

  it('deletes a project, its versions and its conversation', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p9', { 'main.js': 'v1' }, { message: 'one', name: 'P9', entry: 'main.js' })
    await store.writeConversation('p9', [{ role: 'user', content: 'x' }])
    await store.deleteProject('p9')
    expect(await store.listProjects()).toEqual([])
    expect(await store.listVersions('p9')).toEqual([])
    expect(await store.readConversation('p9')).toBeNull()
  })
})

describe('local work tracking', () => {
  it('stays clean until the session writes content, and markClean resets it', async () => {
    const store = createLocalStorage()
    expect(store.isDirty()).toBe(false)
    await store.writeFiles('w1', { 'main.js': 'v1' }, { message: 'create', name: 'W1', entry: 'main.js' })
    expect(store.isDirty()).toBe(true)
    store.markClean()
    expect(store.isDirty()).toBe(false)
  })

  it('a delete alone is not work a reload would lose', async () => {
    const store = createLocalStorage()
    await store.writeFiles('w2', { 'main.js': 'v1' }, { message: 'create', name: 'W2', entry: 'main.js' })
    store.markClean()
    await store.deleteProject('w2')
    expect(store.isDirty()).toBe(false)
  })

  it('conversations count as local work', async () => {
    const store = createLocalStorage()
    store.markClean()
    await store.writeConversation('w3', [{ role: 'user', content: 'x' }])
    expect(store.isDirty()).toBe(true)
  })
})

// A fresh store over the same database is what a reload builds, so its reads
// must find what the last session stored. A per-test database name keeps the
// file's other stores (which get no indexedDB) isolated.
const overIdb = () => {
  const dbName = `jscad-web-local-test-${crypto.randomUUID()}`
  return (options = {}) => createLocalStorage({ indexedDB: fakeIndexedDB, dbName, ...options })
}

describe('local file removal', () => {
  it('drops a file with no version row and no dirt', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p1', { 'main.js': 'm', 'lib.js': 'l' }, { message: 'create', name: 'P', entry: 'main.js' })
    store.markClean()
    await store.removeFiles('p1', ['lib.js'])
    expect((await store.readProject('p1')).files).toEqual({ 'main.js': 'm' })
    expect(await store.listVersions('p1')).toHaveLength(1)
    expect(store.isDirty()).toBe(false)
  })

  it('is a no-op for an unknown project or a path it does not hold', async () => {
    const store = createLocalStorage()
    await store.removeFiles('missing', ['lib.js'])
    await store.writeFiles('p1', { 'main.js': 'm' }, { name: 'P', entry: 'main.js' })
    await store.removeFiles('p1', ['gone.js'])
    expect((await store.readProject('p1')).files).toEqual({ 'main.js': 'm' })
  })

  it('persists a removal across a reload', async () => {
    const open = overIdb()
    const first = open()
    await first.writeFiles('p1', { 'main.js': 'm', 'lib.js': 'l' }, { message: 'create', name: 'P', entry: 'main.js' })
    await first.removeFiles('p1', ['lib.js'])

    const second = open()
    expect((await second.readProject('p1')).files).toEqual({ 'main.js': 'm' })
  })
})

describe('local persistence availability', () => {
  it('reports IndexedDB persistence active, and inactive without it', () => {
    const dbName = `jscad-web-persists-test-${crypto.randomUUID()}`
    expect(createLocalStorage({ indexedDB: fakeIndexedDB, dbName }).persists()).toBe(true)
    expect(createLocalStorage({ indexedDB: null }).persists()).toBe(false)
  })
})

describe('local persistence (IndexedDB)', () => {
  it('a second store over the same database sees the first store’s projects, versions and conversations', async () => {
    const open = overIdb()
    const first = open()
    await first.writeFiles('p1', { 'main.js': MAIN }, { message: 'create', name: 'Gear', entry: 'main.js' })
    await first.writeFiles('p1', { 'main.js': 'v2', 'lib.js': 'l' }, { message: 'chat', version: false })
    await first.snapshot('p1', { message: 'chat' })
    await first.writeConversation('p1', [{ role: 'user', content: 'make a gear' }])

    const second = open()
    expect((await second.readProject('p1')).files).toEqual({ 'main.js': 'v2', 'lib.js': 'l' })
    expect((await second.listVersions('p1')).map((v) => v.message)).toEqual(['chat', 'create'])
    expect((await second.readConversation('p1')).messages).toEqual([{ role: 'user', content: 'make a gear' }])
  })

  it('persists a project deletion', async () => {
    const open = overIdb()
    const first = open()
    await first.writeFiles('p1', { 'main.js': MAIN }, { message: 'create', name: 'Gear', entry: 'main.js' })
    await first.deleteProject('p1')

    const second = open()
    expect(await second.listProjects()).toEqual([])
    await expect(second.readProject('p1')).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('falls back to the in-memory Maps, and keeps the dirty flag, with no indexedDB', async () => {
    const store = createLocalStorage({ indexedDB: null })
    await store.writeFiles('p1', { 'main.js': MAIN }, { message: 'create', name: 'Gear', entry: 'main.js' })
    expect((await store.readProject('p1')).files).toEqual({ 'main.js': MAIN })
    expect(store.isDirty()).toBe(true)
  })
})
