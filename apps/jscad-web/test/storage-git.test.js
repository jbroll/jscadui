import { describe, expect, it } from 'vitest'
import { GitStorageError, createGitStorage } from '../src/storage/git.js'

const files = {
  'main.js': 'main() {}',
  '.jscad-web.json': JSON.stringify({ name: 'n', entry: 'main.js' }),
}
const legacyFiles = {
  'part.scad': 'cube(5);',
  '.jscad-studio.json': JSON.stringify({ name: 'old', entry: 'part.scad' }),
}

const ok = (body) => ({ status: 200, ok: true, json: async () => body })

const storage = (fetchFn) =>
  createGitStorage({ apiBase: 'https://api.test', installationId: '7', owner: 'o', repo: 'r', fetchFn })

describe('git storage', () => {
  it('reads the project without the meta file', async () => {
    const s = storage(async () => ok({ files }))
    const project = await s.readProject()
    expect(project.entry).toBe('main.js')
    expect(project.mode).toBe('git')
    expect(project.files['.jscad-web.json']).toBe(undefined)
  })

  it('reads a repo that still carries the jscad-studio meta file', async () => {
    const s = storage(async () => ok({ files: legacyFiles }))
    const project = await s.readProject()
    expect(project.name).toBe('old')
    expect(project.entry).toBe('part.scad')
    expect(project.files).toEqual({ 'part.scad': 'cube(5);' })
  })

  it('writes the meta as .jscad-web.json', async () => {
    const seen = []
    const s = storage(async (url, init) => {
      seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
      if (String(url).includes('/versions?')) return ok([{ sha: 'abc', message: 'm', created: 1 }])
      if (String(url).includes('/write')) return ok({ commitSha: 'def' })
      return ok({ files: legacyFiles })
    })
    await s.writeFiles('o/r:@root', { 'part.scad': 'x' }, {})
    const written = seen.find((c) => String(c.url).includes('/write')).body.files
    expect(JSON.parse(written['.jscad-web.json'])).toMatchObject({ name: 'old', entry: 'part.scad' })
    expect(written['.jscad-studio.json']).toBe(undefined)
  })

  it('exports a zip that local storage can import', async () => {
    const { createLocalStorage } = await import('../src/storage/local.js')
    const { importZip } = await import('../src/storage/zip.js')
    const zip = await storage(async () => ok({ files })).exportZip()
    const local = createLocalStorage()
    const project = await local.readProject((await importZip(local, zip)).id)
    expect(project.files).toEqual({ 'main.js': 'main() {}' })
  })

  it('writes with the head sha as expectedSha', async () => {
    const seen = []
    const s = storage(async (url, init) => {
      seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
      if (String(url).includes('/versions?')) return ok([{ sha: 'abc', message: 'm', created: 1 }])
      if (String(url).includes('/write')) return ok({ commitSha: 'def' })
      return ok({ files })
    })
    const res = await s.writeFiles('o/r:@root', { 'main.js': 'x' }, {})
    const write = seen.find((c) => String(c.url).includes('/write'))
    expect(write.body.expectedSha).toBe('abc')
    expect(res.commitSha).toBe('def')
  })

  it('maps a branch-moved 409 to GitStorageError', async () => {
    const s = storage(async () => ({ status: 409, ok: false, json: async () => ({}) }))
    await expect(s.readProject()).rejects.toThrowError(GitStorageError)
  })

  it('requires apiBase, installationId, owner and repo', () => {
    expect(() => createGitStorage({})).toThrowError(GitStorageError)
  })
})
