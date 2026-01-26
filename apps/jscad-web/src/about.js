const about = /** @type {HTMLDivElement}*/ (document.getElementById('about'))
const aboutLink = /** @type {HTMLAnchorElement}*/ (document.getElementById('about-link'))
const aboutClose = /** @type {HTMLButtonElement}*/ (document.getElementById('about-close'))

/** @type {(() => void) | null} */
let cleanupFn = null

export const init = () => {
  if (!about || !aboutLink) return

  /**
   * @param {MouseEvent} e
   */
  const handleLinkClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    show()
  }

  /**
   * @param {MouseEvent} e
   */
  const handleCloseClick = (e) => {
    e.stopPropagation()
    dismiss()
  }

  /**
   * @param {MouseEvent} e
   */
  const handleOutsideClick = (e) => {
    if (!about.classList.contains('hidden') && !about.contains(/** @type {Node} */(e.target))) {
      dismiss()
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  const handleEscape = (e) => {
    if (e.key === 'Escape' && !about.classList.contains('hidden')) {
      dismiss()
    }
  }

  aboutLink.addEventListener('click', handleLinkClick)
  aboutClose.addEventListener('click', handleCloseClick)
  window.addEventListener('mousedown', handleOutsideClick)
  window.addEventListener('keydown', handleEscape)

  cleanupFn = () => {
    aboutLink.removeEventListener('click', handleLinkClick)
    aboutClose.removeEventListener('click', handleCloseClick)
    window.removeEventListener('mousedown', handleOutsideClick)
    window.removeEventListener('keydown', handleEscape)
    cleanupFn = null
  }
}

export const destroy = () => {
  if (cleanupFn) cleanupFn()
}

export const show = () => {
  if (!about) return
  about.classList.remove('hidden')
}

export const dismiss = () => {
  if (!about) return
  about.classList.add('hidden')
}
