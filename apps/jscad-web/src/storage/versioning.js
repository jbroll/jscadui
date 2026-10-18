// Version-chunking primitives shared by the storage backends and the chat
// wiring: how long a burst of editor compiles may share one version row, how a
// turn's text names its chat version, and how two file maps are compared so an
// unchanged project mints no row.

/**
 * The idle window, in milliseconds, during which editor compiles coalesce into
 * one version row. Five minutes keeps a run of compiles together while a pause
 * longer than that starts a fresh row.
 * @type {number}
 */
export const EDIT_COALESCE_MS = 300000

/**
 * Collapse an arbitrary text run into a single-line excerpt for a version
 * message: whitespace becomes single spaces, ends are trimmed, and the result
 * is capped at `max` characters.
 * @param {string} text
 * @param {number} [max] maximum length, default 60
 * @returns {string}
 */
export function excerptOf(text, max = 60) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * The version message for an agent turn: `chat: <excerpt>` when the turn has
 * text, a bare `chat` otherwise (also what old rows carry).
 * @param {string} excerpt
 * @returns {string}
 */
export function chatVersionMessage(excerpt) {
  return excerpt ? `chat: ${excerpt}` : 'chat'
}

/**
 * Whether two `path -> content` file maps hold the same paths and content.
 * @param {Record<string, string>} a
 * @param {Record<string, string>} b
 * @returns {boolean}
 */
export function sameFiles(a, b) {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false
  }
  return true
}
