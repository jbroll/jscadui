const menu = /** @type {HTMLElement} */ (document.getElementById('menu'))

/** @type {(() => void) | null} */
let cleanupFn = null

/**
 * @callback OnBrowseDemos
 */

/**
 * @param {object} opts
 * @param {OnBrowseDemos} [opts.onBrowseDemos] - called when user clicks "Browse Demos…"
 */
export const init = ({ onBrowseDemos } = {}) => {
  const button = /** @type {HTMLElement} */ (document.getElementById('menu-button'))
  const content = /** @type {HTMLElement} */ (document.getElementById('menu-content'))

  const handleButtonClick = () => {
    menu.classList.toggle('open')
  }

  const handleWindowClick = (e) => {
    if (!button.contains(e.target) && !content.contains(e.target)) {
      dismiss()
    }
  }

  const handleDismiss = () => dismiss()

  // Menu button
  button.addEventListener('click', handleButtonClick)

  // Close menu when anything else is clicked
  window.addEventListener('click', handleWindowClick)
  window.addEventListener('drop', handleDismiss)
  window.addEventListener('dragstart', handleDismiss)
  window.addEventListener('dragover', handleDismiss)

  // Add "Browse Demos…" button in place of the old static examples list
  const exampleDiv = /** @type {HTMLElement} */ (document.getElementById('examples'))
  if (exampleDiv && onBrowseDemos) {
    const browseBtn = document.createElement('button')
    browseBtn.className = 'menu-link-btn'
    browseBtn.textContent = 'Browse Demos…'
    browseBtn.addEventListener('click', () => {
      dismiss()
      onBrowseDemos()
    })
    const li = document.createElement('li')
    li.appendChild(browseBtn)
    exampleDiv.appendChild(li)
  }

  // Store cleanup function
  cleanupFn = () => {
    button.removeEventListener('click', handleButtonClick)
    window.removeEventListener('click', handleWindowClick)
    window.removeEventListener('drop', handleDismiss)
    window.removeEventListener('dragstart', handleDismiss)
    window.removeEventListener('dragover', handleDismiss)
    cleanupFn = null
  }
}

/**
 * Cleanup event listeners added by init()
 */
export const destroy = () => {
  if (cleanupFn) cleanupFn()
}

const dismiss = () => {
  menu.classList.remove('open')
}
