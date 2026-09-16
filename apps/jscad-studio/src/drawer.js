// Thresholds for drag detection
const DRAG_THRESHOLD_PX = 5
const LONG_PRESS_MS = 200

let isMouseDown = false
let isDragging = false
let dragStartX = 0
let dragStartWidth = 0
let dragStartTime = 0

/** @type {(() => void) | null} */
let cleanupFn = null

// Initialize drawer action
// Initial open/closed state is in index.html to prevent flash of content
export const init = () => {
  const editor = /** @type {HTMLElement} */ (document.getElementById('editor'))
  const toggle = /** @type {HTMLElement} */ (document.getElementById('editor-toggle'))

  /**
   * Set editor width and handle open/closed state
   * @param {number} w
   */
  const setEditorWidth = (w) => {
    if (w > 0) {
      editor.style.width = `${w}px`
      editor.classList.remove('closed')
    } else {
      editor.classList.add('closed')
    }
  }

  const handleClick = () => {
    if (!isDragging) {
      editor.classList.add('transition') // animate
      const isClosed = editor.classList.contains('closed')
      localStorage.setItem('editor.closed', String(!isClosed))
      if (isClosed) {
        setEditorWidth(parseInt(localStorage.getItem('editor.width') ?? "400", 10))
      } else {
        setEditorWidth(0)
      }
    }
  }

  const handlePointerDown = (e) => {
    isMouseDown = true
    isDragging = false
    dragStartX = e.clientX
    dragStartWidth = editor.offsetWidth
    dragStartTime = e.timeStamp
    e.preventDefault()
  }

  const handlePointerMove = (e) => {
    if (isMouseDown) {
      const delta = e.clientX - dragStartX
      // Moved more than threshold, assume dragging
      if (isDragging || Math.abs(delta) > DRAG_THRESHOLD_PX) {
        isDragging = true
        editor.classList.remove('transition') // no animation when dragging
        const width = Math.max(0, dragStartWidth - delta)
        setEditorWidth(width)
      }
    }
  }

  const handlePointerUp = (e) => {
    const downTime = e.timeStamp - dragStartTime
    // Long press, assume dragging
    if (isDragging || downTime > LONG_PRESS_MS) {
      // Prevent click
      isDragging = true
      // Save width
      const width = editor.offsetWidth
      // Minimum width, otherwise snap to closed
      if (width > 50) {
        localStorage.setItem('editor.width', String(width))
        localStorage.setItem('editor.closed', "false")
      } else {
        localStorage.setItem('editor.closed', "true")
        editor.classList.add('transition') // snap closed
        setEditorWidth(0)
      }
    }
    isMouseDown = false
  }

  toggle.addEventListener('click', handleClick)
  toggle.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)

  // Store cleanup function
  cleanupFn = () => {
    toggle.removeEventListener('click', handleClick)
    toggle.removeEventListener('pointerdown', handlePointerDown)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    cleanupFn = null
  }
}

/**
 * Cleanup event listeners added by init()
 */
export const destroy = () => {
  if (cleanupFn) cleanupFn()
}
