/**
 * This is OrbitControl starting as a simpler and more primitive than others, meant to support multiple webgl engines.
 *
 * Some resources considered while in making (aside from looking a bit onto other OrbitControl implementations):
 * https://webglfundamentals.org/webgl/lessons/webgl-3d-camera.html
 * https://elalish.blogspot.com/2022/04/3d-interaction.html
 * https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/three-components/SmoothControls.ts
 */
import { OrbitState } from './OrbitState.js'
import { getCommonRotCombined } from './commonCamera.js'
import { closerAngle } from './normalizeAngle.js'

const { PI } = Math

export class OrbitControl extends OrbitState {
  el
  animDuration = 200

  /** @type {{startTime:number,stateStart:OrbitState,stateEnd:OrbitState} | undefined} */
  currentAnimation = undefined;

  /** @type {number | undefined} */
  #rafHandle = undefined

  /** @type {boolean} */
  #destroyed = false

  /** @type {Array<{el: HTMLElement, type: string, handler: EventListener}>} */
  #listeners = []

  /**
   * @param {HTMLElement|Array<HTMLElement>} el
   * @param {import('../cameraState.js').OrbitControlInit} options
   */
  constructor(el, { position, target = [0, 0, 0], rx = PI / 4, rz = PI / 4, len = 200, panRatio = 800, rxRatio = 0.01, rzRatio = 0.01, zoomRatio = 0.05 }) {
    super({ position, target, rx, rz, len })

    this.el = el
    this.rxRatio = rxRatio
    this.rzRatio = rzRatio

    let isDown = false
    let doubleDown = false
    let isPan = false
    let isZoom = false
    let isMoving = false
    let theButton = 0
    let lx = 0
    let ly = 0

    // Pinch to zoom gesture
    /** @type {Map<number,[number,number]>} */
    const pointers = new Map();

    /** @type {Pinch | undefined} */
    let lastPinch

    /**
     * Calculate distance and midpoint of two pointers
     * @returns {Pinch | null}
     */
    const calculatePinch = () => {
      if (pointers.size < 2) return null
      const [p1, p2] = pointers.values();
      const [x1, y1] = p1
      const [x2, y2] = p2
      const dx = x2 - x1
      const dy = y2 - y1
      return {
        distance: Math.sqrt(dx * dx + dy * dy),
        midpoint: [(x1 + x2) / 2, (y1 + y2) / 2],
      }
    }

    /**
     * @param {HTMLElement} el
     * @param {string} type
     * @param {EventListener} handler
     */
    const addListener = (el, type, handler) => {
      el.addEventListener(type, handler)
      this.#listeners.push({ el, type, handler })
    }

    /**
     * @param {HTMLElement} el
     */
    const doListen = el => {
      /** @param {PointerEvent} e */
      const onPointerDown = e => {
        theButton = e.button
        lx = e.clientX
        ly = e.clientY
        isDown = true
        pointers.set(e.pointerId, [e.clientX, e.clientY])
        if (pointers.size === 2) doubleDown = true
      }

      /** @param {PointerEvent} e */
      const onPointerUp = e => {
        isDown = false
        if (isMoving) el.releasePointerCapture(e.pointerId)
        isMoving = false
        pointers.delete(e.pointerId)
        if (pointers.size < 2) {
          doubleDown = false
          lastPinch = undefined
        }
      }

      /** @param {WheelEvent} e */
      const onWheel = e => {
        const dir = Math.sign(e.deltaY)
        this.zoomBy(dir * zoomRatio)
      }

      /** @param {PointerEvent} e */
      const onPointerMove = e => {
        if (!isDown) return

        if (!isMoving) {
          // pointer capture inside pointerdown caused clicking to not work
          // it is better to capture pointer only on pointer down + first movement
          el.setPointerCapture(e.pointerId)
          isMoving = true
        }

        isPan = theButton === 1 || (theButton === 0 && e.shiftKey)
        isZoom = e.ctrlKey
        let dx = lx - e.clientX
        let dy = ly - e.clientY
        pointers.set(e.pointerId, [e.clientX, e.clientY])

        if (isPan) {
          const ratio = this.len / panRatio
          this.panBy(dx * ratio, dy * ratio)
        } else if (isZoom) {
          this.zoomBy((dx + dy) / 200)
        } else if (doubleDown) {
          // Pinch to zoom and pan
          const newPinch = calculatePinch()
          if (!newPinch) return // Guard against race condition
          if (lastPinch) {
            // Pan
            const dx = lastPinch.midpoint[0] - newPinch.midpoint[0]
            const dy = lastPinch.midpoint[1] - newPinch.midpoint[1]
            const ratio = this.len / panRatio
            this.panBy(dx * ratio, dy * ratio)
            // Zoom
            const pinchFactor = newPinch.distance / lastPinch.distance
            this.zoomBy(1 - pinchFactor)
          }
          lastPinch = newPinch
        } else {
          this.rotateBy(dy * this.rxRatio, dx * this.rzRatio)
        }
        lx = e.clientX
        ly = e.clientY
      }

      addListener(el, 'pointerdown', onPointerDown)
      addListener(el, 'pointerup', onPointerUp)
      addListener(el, 'pointercancel', onPointerUp)
      addListener(el, 'wheel', onWheel)
      addListener(el, 'pointermove', onPointerMove)
    }

    if (el instanceof Array) el.forEach(doListen)
    else doListen(el)

    this.#rafHandle = requestAnimationFrame(() => this.doAnim())
  }

  doAnim() {
    if (this.#destroyed) return

    if (this.currentAnimation !== undefined) {
      const { stateStart, stateEnd, startTime } = this.currentAnimation;
      const progress = Math.min(1, (Date.now() - startTime) / this.animDuration)
      const newState = stateStart.calcAnim(stateEnd, progress)
      this.setRotate(newState.rx, newState.rz, newState.target, false)
      // update orbit control so it can continue working during or after anim
      this.fireInput()
      if (progress >= 1) {
        this.stopAnim()
      }
    }
    this.#rafHandle = requestAnimationFrame(() => this.doAnim())
  }

  stopAnim() {
    this.currentAnimation = undefined
    this.fireChange()
  }

  /**
   * Clean up all event listeners and stop animation loop.
   * Call this when the OrbitControl is no longer needed.
   */
  destroy() {
    this.#destroyed = true
    if (this.#rafHandle !== undefined) {
      cancelAnimationFrame(this.#rafHandle)
      this.#rafHandle = undefined
    }
    for (const { el, type, handler } of this.#listeners) {
      el.removeEventListener(type, handler)
    }
    this.#listeners = []
  }

  /**
   * @param {{target?:[number,number,number],rx:number,rz:number}} options
   */
  animateToCamera({ target, rx, rz }) {
    // normalize angle to avoid crazy spinning if scene was rotated a lot
    // rx does not need this fix as it only operates inside one half of a rotation
    this.rz = closerAngle(this.rz, rz)

    this.currentAnimation = {
      startTime: Date.now(),
      stateStart: new OrbitState(this, true),
      stateEnd: new OrbitState({ target: target ?? this.target, rx, rz, len: this.len }),
    }
  }

  /**
   * @param {string} targetRotation 
   */
  animateToCommonCamera(targetRotation) {
    const [rx, rz] = getCommonRotCombined(targetRotation)
    this.animateToCamera({ rx, rz, target: [0, 0, 0] })
  }
}

/**
 * @typedef {object} Pinch
 * @property {number} distance
 * @property {[number,number]} midpoint
 */