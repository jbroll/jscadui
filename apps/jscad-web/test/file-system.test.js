import { describe, expect, it } from 'vitest'
import * as fileSystem from '../src/fileSystem.js'

// No service worker registered: models still run, from files the app keeps in memory.
describe('project files without a service worker', () => {
  it('keeps what the app writes and hands it to every run', async () => {
    expect(fileSystem.getSwHandler()).toBeUndefined()
    await fileSystem.addToCacheWrapper('main.js', 'module.exports = { main }')
    await fileSystem.addToCacheWrapper('/lib/part.js', 'part')
    expect(await fileSystem.projectFiles()).toEqual({ 'main.js': 'module.exports = { main }', 'lib/part.js': 'part' })
  })

  it('empties with the project cache', async () => {
    await fileSystem.addToCacheWrapper('main.js', 'x')
    await fileSystem.clearProjectCache()
    expect(await fileSystem.projectFiles()).toEqual({})
  })
})
