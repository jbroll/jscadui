const handled = new WeakSet()

/**
 * Whether an Escape keydown should close `panel`, given the selector of the
 * other side panel that can be open beside it.
 * @param {KeyboardEvent} e
 * @param {HTMLElement|null} panel
 * @param {string} otherSelector
 */
export function escapeCloses(e, panel, otherSelector) {
  if (e.key !== 'Escape' || !panel || handled.has(e)) return false
  const other = document.querySelector(otherSelector)
  const target = e.target instanceof Node ? e.target : null
  let mine
  if (!other || panel.contains(target)) mine = true
  else if (other.contains(target)) mine = false
  // Focus in neither panel: the one opened last is later in the body.
  else mine = Boolean(other.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)
  // Both panels listen on document; the first to close must not leave the other free to close too.
  if (mine) handled.add(e)
  return mine
}
