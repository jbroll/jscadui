const handled = new WeakSet()

/**
 * Whether an Escape keydown should close `panel` — the panel holding focus, or
 * the newest of the open panels (the one later in the body) when focus is in
 * none. `otherSelectors` names every other panel class that can be open beside
 * it; each panel's keydown listener calls this with its own panel.
 * @param {KeyboardEvent} e
 * @param {HTMLElement|null} panel
 * @param {string[]} otherSelectors
 */
export function escapeCloses(e, panel, otherSelectors) {
  if (e.key !== 'Escape' || !panel || handled.has(e)) return false
  const others = [...document.querySelectorAll(otherSelectors.join(','))]
  const target = e.target instanceof Node ? e.target : null
  let mine
  if (panel.contains(target)) mine = true
  else if (others.some((other) => other.contains(target))) mine = false
  // Focus in neither panel: the one opened last is later in the body.
  else mine = others.every((other) => other.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)
  // All panels listen on document; the first to close must not leave the others free to close too.
  if (mine) handled.add(e)
  return mine
}
