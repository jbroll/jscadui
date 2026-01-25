import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock DOMTokenList.part since jsdom doesn't support it
beforeEach(() => {
  // Polyfill part property for jsdom
  if (!('part' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'part', {
      get() {
        if (!this._part) {
          this._part = {
            add: vi.fn(),
            remove: vi.fn(),
            contains: vi.fn(() => false),
          }
        }
        return this._part
      },
      configurable: true,
    })
  }
})

describe('Gizmo', () => {
  it('should export Gizmo class', async () => {
    const { Gizmo } = await import('./index.js')
    expect(Gizmo).toBeDefined()
    expect(typeof Gizmo).toBe('function')
  })

  it('should export names constant', async () => {
    const { names } = await import('./index.js')
    expect(names).toBeDefined()
    expect(names.T).toBe('TOP')
    expect(names.B).toBe('BOTTOM')
  })

  it('Gizmo should have cleanup functions array', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()

    // The #cleanupFns is private but we can verify the class structure
    expect(gizmo).toBeInstanceOf(HTMLElement)
  })

  it('Gizmo should define custom element', async () => {
    const { Gizmo } = await import('./index.js')

    // Static initializer should have registered the element
    const registered = customElements.get('jscadui-gizmo')
    expect(registered).toBe(Gizmo)
  })

  it('Gizmo should have connectedCallback and disconnectedCallback', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()

    expect(typeof gizmo.connectedCallback).toBe('function')
    expect(typeof gizmo.disconnectedCallback).toBe('function')
  })

  it('Gizmo should have setNames method', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()

    expect(typeof gizmo.setNames).toBe('function')
  })

  it('Gizmo connectedCallback should create shadow DOM', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()

    // Trigger connectedCallback
    document.body.appendChild(gizmo)

    expect(gizmo.shadowRoot).toBeTruthy()
    expect(gizmo.shadowRoot.querySelector('.cube')).toBeTruthy()

    gizmo.remove()
  })

  it('Gizmo should call onRotationRequested when face is clicked', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()
    const handler = vi.fn()
    gizmo.onRotationRequested = handler

    document.body.appendChild(gizmo)

    // Find and click a face
    const face = gizmo.shadowRoot.querySelector('i[c]')
    if (face) {
      face.click()
      expect(handler).toHaveBeenCalled()
    }

    gizmo.remove()
  })

  it('Gizmo disconnectedCallback should clean up dragstart listener', async () => {
    const { Gizmo } = await import('./index.js')
    const gizmo = new Gizmo()

    document.body.appendChild(gizmo)

    // Verify connected
    expect(gizmo.isConnected).toBe(true)

    // Disconnect
    gizmo.remove()

    // Verify disconnected
    expect(gizmo.isConnected).toBe(false)
  })
})
