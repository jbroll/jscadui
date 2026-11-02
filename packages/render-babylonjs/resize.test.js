import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RenderBabylon } from './index.js'

class Stub {
  setPosition() {}
  addLight() {}
  detachControl() {}
}

const fakeBabylon = renders => ({
  Scene: class extends Stub {
    render() { renders.push('render') }
  },
  Engine: class {
    runRenderLoop() {}
    resize() { renders.push('resize') }
  },
  HemisphericLight: Stub,
  ArcRotateCamera: Stub,
  Vector3: Stub,
  Color3: Stub,
})

const fakeCanvas = () => ({ setAttribute() {}, addEventListener() {} })

describe('resize', () => {
  beforeEach(() => vi.stubGlobal('document', { createElement: fakeCanvas }))
  afterEach(() => vi.unstubAllGlobals())

  it('renders in the same call so the cleared buffer is never shown', () => {
    const renders = []
    const viewer = RenderBabylon(fakeBabylon(renders))({ appendChild() {} })

    viewer.resize({ width: 300, height: 200 })
    expect(renders).toEqual(['resize', 'render'])
  })
})
