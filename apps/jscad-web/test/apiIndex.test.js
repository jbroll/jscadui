import { describe, expect, it, vi } from 'vitest'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import index from '@jscadui/agent-loop/api/index.json'
import bundled from '../src_bundle/bundle.api-index.js'
import { createDocs, createIndexLoader } from '../src/apiIndex.js'
import { esbDef } from '../src_build/esbuildUtil.js'
import { rawImportPlugin } from '../src_build/rawImport.js'

const APP = fileURLToPath(new URL('..', import.meta.url))

describe('API index loading', () => {
  it('loads the index once, however often it is asked for', async () => {
    const load = vi.fn(async () => index)
    const loadIndex = createIndexLoader(load)
    expect(await loadIndex()).toBe(index)
    expect(await loadIndex()).toBe(index)
    expect(load).toHaveBeenCalledOnce()
  })

  it('tries again after a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(index)
    const loadIndex = createIndexLoader(load)
    await expect(loadIndex()).rejects.toThrow('offline')
    expect(await loadIndex()).toBe(index)
  })

  it('answers the chat docs tool on first use, in the chat api', async () => {
    let api = 'modeling'
    const load = vi.fn(async () => index)
    const docs = createDocs(createIndexLoader(load), () => api)
    expect(load).not.toHaveBeenCalled()
    expect(await docs('cube')).toMatch(/^primitives\.cube \(@jscad\/modeling\)/)
    api = 'fluent'
    expect(await docs('cube')).toMatch(/^jf\.cube \(@jbroll\/jscad-fluent\)/)
    expect(load).toHaveBeenCalledOnce()
  })

  it('ships the index as its own bundle', () => {
    expect(bundled).toBe(index)
  })

  it('keeps the index out of the app entry bundle', async () => {
    const { metafile } = await esbuild.build({
      ...esbDef,
      absWorkingDir: APP,
      entryPoints: ['main.js'],
      loader: { '.example.js': 'text', '.js': 'tsx', '.jsx': 'tsx' },
      plugins: [rawImportPlugin],
      write: false,
      minify: false,
      sourcemap: false,
      metafile: true,
      outfile: 'out.js',
      logLevel: 'silent',
    })
    const inputs = Object.keys(metafile.inputs)
    expect(inputs.some((file) => file.endsWith('src/apiIndex.js'))).toBe(true)
    expect(inputs.filter((file) => file.endsWith('agent-loop/api/index.json'))).toEqual([])
  }, 60_000)
})
