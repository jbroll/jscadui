import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RenderThreejs } from './index.js'

class Stub {
  constructor() {
    this.position = { set() {}, toArray: () => [0, 0, 0] }
    this.up = { set() {} }
  }
  set() {}
  add() {}
  remove() {}
  lookAt() {}
  updateProjectionMatrix() {}
}

const fakeThree = renders => ({
  PerspectiveCamera: Stub,
  AmbientLight: Stub,
  HemisphereLight: Stub,
  DirectionalLight: Stub,
  Scene: Stub,
  Group: Stub,
  Vector3: Stub,
  Color: Stub,
  Matrix4: Stub,
  MeshPhongMaterial: Stub,
  LineBasicMaterial: Stub,
  WebGLRenderer: class {
    setPixelRatio() {}
    setSize(w, h) { renders.push(`size ${w}x${h}`) }
    render() { renders.push('render') }
  },
})

describe('resize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    vi.stubGlobal('document', { createElement: () => ({}) })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders in the same call so the cleared buffer is never shown', () => {
    const renders = []
    const viewer = RenderThreejs(fakeThree(renders))({ appendChild() {} })
    vi.runAllTimers()
    renders.length = 0

    viewer.resize({ width: 300, height: 200 })
    expect(renders).toEqual(['size 300x200', 'render'])
  })

  it('cancels a pending deferred render instead of rendering twice', () => {
    const renders = []
    const viewer = RenderThreejs(fakeThree(renders))({ appendChild() {} })
    vi.runAllTimers()
    renders.length = 0

    viewer.setBg([0, 0, 0])
    viewer.resize({ width: 300, height: 200 })
    vi.runAllTimers()
    expect(renders).toEqual(['size 300x200', 'render'])
  })
})
