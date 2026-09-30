import { describe, expect, it, vi } from 'vitest'
import index from '@jscadui/agent-loop/api/index.json'
import { runTimeoutError } from '@jscadui/agent-loop'
import { createProjectTools } from '../src/aiDeps.js'
import { createLocalStorage } from '../src/storage/local.js'
import { createSession } from '../src/storage/session.js'

// The open project as main.js sees it: the file cache every run sends the
// frame. `open` is a project switch.
const fakeProject = (initial = {}, id = 'p1') => {
  let files = { ...initial }
  let projectId = id
  return {
    getProjectFiles: async () => ({ ...files }),
    writeProjectFile: vi.fn(async (path, content) => {
      files[path] = content
    }),
    getProjectId: () => projectId,
    open: (next, nextId) => {
      files = { ...next }
      projectId = nextId
    },
    files: () => files,
  }
}

const REPORT = { ok: true, entry: 'main.js', warnings: [], console: [], params: [], geometry: { parts: 1 } }

const tools = ({ project = fakeProject(), workerApi = {}, ...rest } = {}) => {
  const deps = {
    getProjectFiles: project.getProjectFiles,
    writeProjectFile: project.writeProjectFile,
    getProjectId: project.getProjectId,
    showFile: vi.fn(),
    build: vi.fn(async () => REPORT),
    noGeometry: vi.fn(async () => null),
    workerApi: {
      jscadSetFiles: vi.fn(async () => {}),
      jscadScript: vi.fn(async () => ({ scratch: true, console: [], warnings: [] })),
      jscadMeasure: vi.fn(async () => ({ volume: 1000 })),
      jscadCheck: vi.fn(async ({ bed }) => ({ watertight: true, ...(bed ? { fitsBed: false } : {}) })),
      ...workerApi,
    },
    exportModel: vi.fn(async () => ({ ok: true, format: 'stla', size: 10 })),
    storeFile: vi.fn(async () => {}),
    snapshot: vi.fn(async () => {}),
    ...rest,
  }
  return { deps, tools: createProjectTools(deps) }
}

describe('list and read', () => {
  it('list answers the project files with their sizes, as the eval does', async () => {
    const { tools: t } = tools({ project: fakeProject({ 'main.js': 'abc', 'lib/a.js': '' }) })
    expect(await t.list()).toEqual({ ok: true, files: [{ path: 'lib/a.js', size: 0 }, { path: 'main.js', size: 3 }] })
  })

  it('read answers numbered lines, and a missing file is an error', async () => {
    const { tools: t } = tools({ project: fakeProject({ 'main.js': 'a\nb\n' }) })
    expect(await t.read({ path: 'main.js' })).toBe('     1\ta\n     2\tb')
    await expect(t.read({ path: 'nope.js' })).rejects.toMatchObject({ name: 'FileNotFoundError' })
  })
})

describe('write and edit', () => {
  it('write puts the file in the project, shows it in the editor and answers the build report', async () => {
    const project = fakeProject({ 'main.js': 'old' })
    const { deps, tools: t } = tools({ project })
    expect(await t.write({ path: './parts/gear.js', content: 'gear' })).toEqual({ saved: 'parts/gear.js', ...REPORT })
    expect(project.files()).toEqual({ 'main.js': 'old', 'parts/gear.js': 'gear' })
    expect(deps.showFile).toHaveBeenCalledWith('parts/gear.js', 'gear', { 'main.js': 'old', 'parts/gear.js': 'gear' })
    expect(deps.build).toHaveBeenCalledTimes(1)
    expect(deps.writeProjectFile.mock.invocationCallOrder[0]).toBeLessThan(deps.build.mock.invocationCallOrder[0])
  })

  it('edit replaces one exact occurrence and builds', async () => {
    const project = fakeProject({ 'main.js': 'const size = 10\n' })
    const { deps, tools: t } = tools({ project })
    await t.edit({ path: 'main.js', oldString: '10', newString: '20' })
    expect(project.files()['main.js']).toBe('const size = 20\n')
    expect(deps.build).toHaveBeenCalledTimes(1)
  })

  it('a refused edit changes nothing and builds nothing', async () => {
    const project = fakeProject({ 'main.js': 'a a' })
    const { deps, tools: t } = tools({ project })
    await expect(t.edit({ path: 'main.js', oldString: 'a', newString: 'b' })).rejects.toMatchObject({ name: 'EditError' })
    await expect(t.write({ path: '../x.js', content: '' })).rejects.toMatchObject({ name: 'PathError' })
    expect(project.files()).toEqual({ 'main.js': 'a a' })
    expect(deps.build).not.toHaveBeenCalled()
  })
})

describe('storage', () => {
  // The app's storage: each chat write goes through at once, with no version
  // row; the turn's version is a snapshot of the stored project at its end.
  const stored = async () => {
    const local = createLocalStorage()
    await local.writeFiles('p1', { 'main.js': 'v0' }, { message: 'create', name: 'P', entry: 'main.js' })
    const session = createSession({ local, getBackend: () => 'local' })
    return {
      local,
      session,
      storeFile: vi.fn((projectId, path, content) => session.writeThrough(projectId, path, content, { message: 'chat', version: false })),
      snapshot: vi.fn((projectId) => session.snapshot(projectId, { message: 'chat' })),
    }
  }
  const messages = async (local, id = 'p1') => (await local.listVersions(id)).map((v) => v.message)

  it('stores each write before it builds, so a reload mid-turn loses nothing', async () => {
    const { local, storeFile, snapshot } = await stored()
    const { deps, tools: t } = tools({ project: fakeProject({ 'main.js': 'v0' }), storeFile, snapshot })
    await t.write({ path: 'main.js', content: 'v1' })
    await t.write({ path: 'lib.js', content: 'lib' })
    expect(storeFile.mock.invocationCallOrder[0]).toBeLessThan(deps.build.mock.invocationCallOrder[0])
    expect((await local.readProject('p1')).files).toEqual({ 'main.js': 'v1', 'lib.js': 'lib' })
    expect(await messages(local)).toEqual(['create'])
  })

  it("saves one version per turn, of the project's final state", async () => {
    const { local, storeFile, snapshot } = await stored()
    const { tools: t } = tools({ project: fakeProject({ 'main.js': 'v0' }), storeFile, snapshot })
    await t.write({ path: 'main.js', content: 'v1' })
    await t.edit({ path: 'main.js', oldString: 'v1', newString: 'v2' })
    await t.endTurn()
    const versions = await local.listVersions('p1')
    expect(versions.map((v) => v.message)).toEqual(['chat', 'create'])
    expect((await local.readVersion('p1', versions[0].versionId)).files).toEqual({ 'main.js': 'v2' })
    await t.endTurn()
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it("keeps the user's editor edit of a file the chat wrote earlier in the turn", async () => {
    const { local, session, storeFile, snapshot } = await stored()
    const { tools: t } = tools({ project: fakeProject({ 'main.js': 'v0' }), storeFile, snapshot })
    await t.write({ path: 'main.js', content: 'chat' })
    await session.writeThrough('p1', 'main.js', 'user', { message: 'edit' })
    await t.endTurn()
    expect((await local.readProject('p1')).files['main.js']).toBe('user')
    const [latest] = await local.listVersions('p1')
    expect((await local.readVersion('p1', latest.versionId)).files['main.js']).toBe('user')
  })

  it('saves nothing for a turn that wrote nothing', async () => {
    const { deps, tools: t } = tools()
    await t.run('console.log(1)')
    await t.endTurn()
    expect(deps.snapshot).not.toHaveBeenCalled()
  })

  it('stores writes in the project they were made in, and snapshots each project the turn wrote to', async () => {
    const project = fakeProject({ 'main.js': 'a' }, 'p1')
    const { deps, tools: t } = tools({ project })
    await t.write({ path: 'main.js', content: 'a2' })
    project.open({ 'main.js': 'b' }, 'p2')
    await t.write({ path: 'part.js', content: 'part' })
    expect(deps.storeFile.mock.calls).toEqual([
      ['p1', 'main.js', 'a2'],
      ['p2', 'part.js', 'part'],
    ])
    await t.endTurn()
    expect(deps.snapshot.mock.calls).toEqual([['p1'], ['p2']])
  })
})

describe('run', () => {
  it('runs the snippet beside the project files as a scratch run and never writes it', async () => {
    const project = fakeProject({ 'main.js': 'm', 'lib.js': 'l' })
    const jscadScript = vi.fn(async () => ({ scratch: true, console: ['1'], warnings: [], returned: '{"a":1}' }))
    const { deps, tools: t } = tools({ project, workerApi: { jscadScript }, getApi: () => 'modeling' })
    expect(await t.run('console.log(1)')).toEqual({ ok: true, warnings: [], console: ['1'], returned: '{"a":1}' })
    expect(jscadScript).toHaveBeenCalledWith(expect.objectContaining({ script: 'console.log(1)', url: 'http://project.local/__run__.js', scratch: true }))
    expect(deps.workerApi.jscadSetFiles).toHaveBeenCalledWith({ files: { 'main.js': 'm', 'lib.js': 'l', '__run__.js': 'console.log(1)' }, api: 'modeling' })
    expect(project.files()).toEqual({ 'main.js': 'm', 'lib.js': 'l' })
    expect(deps.build).not.toHaveBeenCalled()
    expect(deps.showFile).not.toHaveBeenCalled()
  })

  it('answers the geometry a main returned', async () => {
    const geometry = { parts: 1, boundingBox: [[0, 0, 0], [1, 1, 1]], dimensions: [1, 1, 1], volume: 1 }
    const { tools: t } = tools({ workerApi: { jscadScript: vi.fn(async () => ({ scratch: true, console: [], warnings: [], geometry })) } })
    expect(await t.run('module.exports = { main }')).toEqual({ ok: true, warnings: [], console: [], geometry })
  })

  it('answers an error with its line and column, its console and a hint for the chat api', async () => {
    const error = { name: 'TypeError', message: 'jf.measureVolume is not a function', stack: 'TypeError: x\n    at main (http://project.local/__run__.js:3:7)' }
    const { tools: t } = tools({
      workerApi: { jscadScript: vi.fn(async () => ({ scratch: true, error, console: ['before'], warnings: [] })) },
      loadIndex: async () => index,
    })
    const res = await t.run('x')
    expect(res).toMatchObject({ ok: false, console: ['before'], warnings: [], error: { name: 'TypeError', file: '__run__.js', line: 3, column: 7 } })
    expect(res.error.message).toContain('measureVolume is a method of FluentGeom3')
  })

  it('refuses a source that is not text', async () => {
    await expect(tools().tools.run(undefined)).rejects.toMatchObject({ name: 'TypeError' })
  })

  it('answers a run the frame stopped at its time limit with the time limit, as the eval does', async () => {
    const timedOut = Object.assign(new Error('model exceeded 30000 ms'), { name: 'TimeoutError' })
    const { tools: t } = tools({ workerApi: { jscadScript: vi.fn(async () => { throw timedOut }) } })
    expect(await t.run('while (true) {}')).toEqual(runTimeoutError())
    const other = tools({ workerApi: { jscadScript: vi.fn(async () => { throw new Error('frame reloaded') }) } })
    await expect(other.tools.run('x')).rejects.toThrow('frame reloaded')
  })
})

describe('measure, check and export', () => {
  it('work on the current build, in millimetres', async () => {
    const { deps, tools: t } = tools()
    expect(await t.measure({})).toEqual({ ok: true, volume: 1000, units: 'mm' })
    expect(await t.check({ bed: [10, 10, 10] })).toEqual({ ok: true, watertight: true, fitsBed: false, units: 'mm' })
    expect(deps.workerApi.jscadCheck).toHaveBeenCalledWith({ bed: [10, 10, 10] })
    expect(await t.exportModel({ format: 'stla' })).toEqual({ ok: true, format: 'stla', size: 10 })
  })

  it('fail with the failed build named when the project does not build', async () => {
    const none = { ok: false, error: { name: 'NoGeometryError', message: 'no geometry: the last build failed (boom); fix it first' } }
    const { deps, tools: t } = tools({ noGeometry: vi.fn(async () => none) })
    expect(await t.measure({})).toBe(none)
    expect(await t.check({})).toBe(none)
    expect(await t.exportModel({ format: 'stla' })).toBe(none)
    expect(deps.workerApi.jscadMeasure).not.toHaveBeenCalled()
    expect(deps.exportModel).not.toHaveBeenCalled()
  })
})
