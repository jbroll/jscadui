import { examples } from './examples.js'

const menu = /** @type {HTMLElement} */ (document.getElementById('menu'))

/** @type {(() => void) | null} */
let cleanupFn = null

export const init = () => {
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

  // Add examples to menu
  const exampleDiv = /** @type {HTMLElement} */ (document.getElementById('examples'))
  examples.forEach(({ name, source }) => {
    const a = document.createElement('a')
    a.innerText = name
    a.addEventListener('click', async () => {
      console.log(`load example ${name} from ${source}`)
      document.location.hash = '#' + source
    })
    const li = document.createElement('li')
    li.appendChild(a)
    exampleDiv.appendChild(li)
  })

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
