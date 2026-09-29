import { afterEach, describe, expect, it } from 'vitest'
import { transformcjs } from '@jscadui/transform-babel/esm/transform-babel.js'

// worker.js registers self.addEventListener at import time.
globalThis.self = { addEventListener() {}, postMessage: () => {} }

const { jscadScript } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('a syntax error with no import to trigger the normal transform', () => {
  afterEach(() => {
    workerState.transformFunc = (x) => x
  })

  it('is re-parsed with the real transform, so the message carries line, column and the offending line', async () => {
    workerState.transformFunc = transformcjs
    const script = 'const x = 1\nconst main (params) => {}\nmodule.exports = { main }'
    await expect(jscadScript({ script, url: 'http://project.local/syntax.js' })).rejects.toThrow(/\(2:\d+\)/)
    await expect(jscadScript({ script, url: 'http://project.local/syntax.js' })).rejects.toThrow(
      'const main (params) => {}',
    )
  })
})
