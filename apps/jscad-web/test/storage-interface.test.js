// Storage interface contract against the fake local backend: every mode
// implements the same shape, so the editor and chat can swap backends.
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
})
