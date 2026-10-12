// @vitest-environment jsdom
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import index from '@jscadui/agent-loop/api/index.json'
import bundled from '../src_bundle/bundle.api-index.js'
import { createDocs, createIndexLoader } from '../src/apiIndex.js'

// jsdom's global Uint8Array is the window's, while its TextEncoder returns one
// from the outer realm; esbuild's realm check wants them to match, so encode
// into the jsdom Uint8Array before esbuild loads.
globalThis.TextEncoder = class {
  encode(input) { return Uint8Array.from(new NodeTextEncoder().encode(input)) }
}
globalThis.TextDecoder = NodeTextDecoder

// The jsdom URL global resolves file: against the dev-server origin, so use
// node's URL for the app dir.
const APP = fileURLToPath(new NodeURL('..', import.meta.url))

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
    const esbuild = await import('esbuild')
    const { esbDef } = await import('@jscadui/demo-utils/src/esbuildUtil.js')
    const { rawImportPlugin } = await import('../src_build/rawImport.js')
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

describe('in-app API help panel', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  let api = 'fluent'

  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
    api = 'fluent'
  })

  const show = async () => {
    const { showApiHelp } = await import('../src/apiHelp.js')
    const { createIndexLoader } = await import('../src/apiIndex.js')
    showApiHelp({ loadIndex: createIndexLoader(async () => index), getApi: () => api })
  }

  const lookUp = async (query) => {
    const input = document.querySelector('.api-help-input')
    input.value = query
    document.querySelector('.api-help-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
  }

  it('answers a function with its options and an example', async () => {
    api = 'modeling'
    await show()
    await lookUp('roundedCuboid')
    const answer = document.querySelector('.api-help-answer').textContent
    expect(answer).toContain('primitives.roundedCuboid (@jscad/modeling)')
    expect(answer).toContain('  roundRadius: Number = 0.2 - radius of rounded edges')
    expect(answer).toContain('Example:')
  })

  it('answers in the chat API style the app currently uses', async () => {
    await show()
    await lookUp('cube')
    expect(document.querySelector('.api-help-answer').textContent).toMatch(/^jf\.cube \(@jbroll\/jscad-fluent\)/)
    api = 'modeling'
    await lookUp('cube')
    expect(document.querySelector('.api-help-answer').textContent).toMatch(/^primitives\.cube \(@jscad\/modeling\)/)
  })

  it('shows a readable message for a name it cannot find', async () => {
    await show()
    await lookUp('roundedCube')
    expect(document.querySelector('.api-help-error').textContent).toContain('no entry roundedCube')
  })

  it('opens on one call and closes on the next', async () => {
    const { showApiHelp } = await import('../src/apiHelp.js')
    const { createIndexLoader } = await import('../src/apiIndex.js')
    const args = { loadIndex: createIndexLoader(async () => index), getApi: () => 'fluent' }
    showApiHelp(args)
    expect(document.querySelector('.api-help-panel')).not.toBeNull()
    showApiHelp(args)
    expect(document.querySelector('.api-help-panel')).toBeNull()
  })
})
