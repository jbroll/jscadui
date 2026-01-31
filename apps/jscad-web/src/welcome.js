const welcome = /** @type {HTMLDivElement}*/ (document.getElementById('welcome'))
const welcomeDismiss = /** @type {HTMLInputElement}*/ (document.getElementById('welcome-dismiss'))
let showing = true

/** @type {(() => void) | null} */
let cleanupFn = null

export const init = () => {
  // hello devs
  console.log('Welcome to JSCAD! Like JavaScript and want to help? Join us at https://github.com/jscad/OpenJSCAD.org')
  if (!welcome) return

  const handleDismissClick = () => {
    localStorage.setItem('welcome.dismissed', "true")
    dismiss()
  }

  // hide the welcome menu when anything is clicked
  window.addEventListener('mousedown', dismiss)
  window.addEventListener('click', dismiss)
  window.addEventListener('drop', dismiss)
  window.addEventListener('dragstart', dismiss)
  window.addEventListener('dragover', dismiss)
  // permanently hide the welcome menu
  welcomeDismiss.addEventListener('click', handleDismissClick)

  // Store cleanup function
  cleanupFn = () => {
    window.removeEventListener('mousedown', dismiss)
    window.removeEventListener('click', dismiss)
    window.removeEventListener('drop', dismiss)
    window.removeEventListener('dragstart', dismiss)
    window.removeEventListener('dragover', dismiss)
    welcomeDismiss?.removeEventListener('click', handleDismissClick)
    cleanupFn = null
  }
}

/**
 * Cleanup event listeners added by init()
 */
export const destroy = () => {
  if (cleanupFn) cleanupFn()
}

/**
 * @param {MouseEvent | DragEvent} [e]
 * @returns 
 */
export const dismiss = (e) => {
  if (!welcome) return
  // dismiss if click on anything other than a link
  const isClickable = ['A', 'LABEL', 'INPUT'].includes(e?.target?.nodeName)
  if (showing && (!e || !welcome.contains(e?.target) || !isClickable)) {
    welcome.remove()
    showing = false
  }
}
