// @ts-expect-error - Vite raw import
import style from './gizmo.css.txt?raw'

/**
 * @typedef {object} SideNames
 * @prop {string} T
 * @prop {string} B
 * @prop {string} N
 * @prop {string} S
 * @prop {string} E
 * @prop {string} W
 */

/** @type {SideNames} */
export const names = {
  T: 'TOP',
  B: 'BOTTOM',
  S: 'FRONT',
  N: 'BACK',
  W: 'LEFT',
  E: 'RIGHT',
}

/** 
 * If using in HTML as tag <jscadui-gizmo/> you must call the static method Gizmo.define().
 * 
 * If creating from code via new Gizmo() static initializer will be triggered automatically.
 * 
 */
export class Gizmo extends HTMLElement {
  static {
    // auto define (guard against multiple registrations)
    if (!customElements.get('jscadui-gizmo')) {
      customElements.define('jscadui-gizmo', this)
    }
  }
  /** Empty method that can be called to trigger static initializer, that will then
   * trigger customElements.define('jscadui-gizmo', this)
   */
  static define() { }

  /** @type {ShadowRoot} */
  #root

  /** @type {HTMLElement} */
  #first = document.createElement('div')

  // L8 fix: Made names private for consistency with other private fields
  /** @type {Record<string, string>} */
  #names

  /** Get the current names mapping */
  get names() { return this.#names }

  /** @type {((rotation:string)=>void) | undefined} */
  onRotationRequested

  constructor(_names = names) {
    super()
    this.#names = _names
  }

  /** @type {((e: DragEvent) => void) | null} */
  #dragHandler = null

  /** @type {Array<() => void>} */
  #cleanupFns = []

  /** Clean up all registered event listeners */
  #cleanupListeners() {
    this.#cleanupFns.forEach(fn => fn())
    this.#cleanupFns = []
  }

  connectedCallback() {
    // Only attach shadow root once (handles reconnection)
    if (!this.#root) {
      this.#root = this.attachShadow({ mode: 'open' })
      const first = this.#first
      first.classList.add("cube")
      const styleElement = document.createElement('style')
      styleElement.innerHTML = style

      this.#root.append(this.#first, styleElement)
    }

    this.setNames(this.names)

    this.#dragHandler = (e) => e.preventDefault()
    this.#first.addEventListener('dragstart', this.#dragHandler)
  }

  disconnectedCallback() {
    if (this.#dragHandler) {
      this.#first.removeEventListener('dragstart', this.#dragHandler)
      this.#dragHandler = null
    }
    this.#cleanupListeners()
  }

  setNames(_names = names) {
    this.#cleanupListeners()

    // Clear existing sides before adding new ones
    while (this.#first.firstChild) {
      this.#first.removeChild(this.#first.firstChild)
    }
    this.#first.append(
      this.#makeSide(_names, 'T', 'TNW,TN,TNE', 'TW,T,TE', 'TSW,TS,TSE'),
      this.#makeSide(_names, 'B', 'BSW,BS,BSE', 'BW,B,BE', 'BNW,BN,BNE'),
      this.#makeSide(_names, 'S', 'TSW,TS,TSE', 'SW,S,SE', 'BSW,BS,BSE'),
      this.#makeSide(_names, 'N', 'TNE,TN,TNW', 'NE,N,NW', 'BNE,BN,BNW'),
      this.#makeSide(_names, 'E', 'TSE,TE,TNE', 'SE,E,NE', 'BSE,BE,BNE'),
      this.#makeSide(_names, 'W', 'TNW,TW,TSW', 'NW,W,SW', 'BNW,BW,BSW'),
    )
  }

  /**
   * @param {number} size 
   */
  setSize(size) {
    this.style.setProperty('--cube-size', size + 'px')
  }

  /**
   * @param {number | string} rx 
   * @param {number | string} rz 
   */
  rotateXZ(rx, rz) {
    if (typeof rx === 'number') rx = rx + 'rad'
    if (typeof rz === 'number') rz = rz + 'rad'
    this.style.setProperty('--cube-transform', `scale3d(0.8,0.8,0.8) rotateX(${rx}) rotateZ(${rz})`)
  }

  /**
   * @param {SideNames} names 
   * @param {string} name 
   * @param  {...string} parts 
   * @returns {HTMLDivElement}
   */
  #makeSide = (names, name, ...parts) => {
    const result = document.createElement('div')
    result.part.add('face')
    result.classList.add('cube__face', `cube__face--${name}`)

    const bg = document.createElement('div')
    bg.classList.add('bg')
    bg.part.add('face-bg')

    result.append(bg)

    result.append(
      ...parts.flatMap(part => part.split(',').map(c => {
        const i = document.createElement('i')
        i.setAttribute('c', c)
        i.textContent = names[c] ?? ''
        const clickHandler = (/** @type {Event} */ e) => {
          e.preventDefault()
          e.stopPropagation()
          this.onRotationRequested?.(c)
        }
        const overHandler = () => this.#mouseover(c, true)
        const outHandler = () => this.#mouseover(c, false)
        i.addEventListener('click', clickHandler)
        i.addEventListener('pointerover', overHandler)
        i.addEventListener('pointerout', outHandler)
        this.#cleanupFns.push(() => {
          i.removeEventListener('click', clickHandler)
          i.removeEventListener('pointerover', overHandler)
          i.removeEventListener('pointerout', outHandler)
        })
        return i
      }))
    )

    return result
  }

  /**
   * @param {string} cam 
   * @param {boolean} over 
   */
  #mouseover = (cam, over) => {
    // select all camera links for the same camera (highlight corners)
    const all = this.#first.querySelectorAll(`[c="${cam}"]`)
    for (const el of all) {
      el.classList.toggle('hover', over)
    }
  }
}
