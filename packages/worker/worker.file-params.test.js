import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

// Node has File but no FileReader, which the fs-provider read path uses.
globalThis.FileReader = class {
  readAsText(file) { file.text().then((text) => this.onload({ target: { result: text } })) }
  readAsArrayBuffer(file) { file.arrayBuffer().then((buf) => this.onload({ target: { result: buf } })) }
}

const { jscadMain } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadMain file params', () => {
  beforeEach(() => {
    workerState.reset()
    workerState.useParamsProxy = undefined
  })

  afterEach(() => {
    workerState.reset()
    workerState.importData = undefined
  })

  it('deserializes a File param through the host importData', async () => {
    const seen = []
    workerState.importData = {
      isBinaryExt: () => false,
      deserialize: (info, content) => {
        seen.push(info.filename)
        return { path: info.filename, content }
      },
    }
    let received
    workerState.main = (params) => {
      received = params
      return []
    }

    await jscadMain({ params: { greeting: new File(['hello'], 'greeting.txt') }, stream: false, solidsOnly: true })

    expect(seen).toEqual(['greeting.txt'])
    expect(received.greeting).toEqual({ path: 'greeting.txt', content: 'hello' })
  })
})
