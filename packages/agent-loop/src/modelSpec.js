/**
 * The per-project model spec: durable user instructions the agent maintains
 * at `notes/model-spec.md` and reads back whole every turn. The `notes/`
 * prefix keeps spec writes out of geometry builds and the code-write test
 * gate (see `isTestOrNotesPath` in project.js); the section below carves it
 * back into the project message, since note bodies otherwise never inline.
 */

/**
 * Project path of the model spec file.
 * @type {string}
 */
export const SPEC_PATH = 'notes/model-spec.md'

/**
 * Max characters of the inlined spec section in the project message. The
 * file itself is unbounded; the section keeps the newest lines so a fresh
 * correction always survives.
 */
export const SPEC_BUDGET = 4000

/**
 * Header opening the spec section in the project message.
 * @type {string}
 */
export const SPEC_HEADER = 'Model spec:'

const TRUNCATED = (shown, total) => `[truncated: showing the newest ${shown} of ${total} characters]\n`

/**
 * The spec section for the project message, or null when the project has no
 * usable spec. Oversized bodies keep their newest lines, cut at a line
 * boundary, with a truncation note on top.
 * @param {Record<string,string|ArrayBuffer>} [files] the project files
 * @param {number} [budget] max characters for the section body
 * @returns {string|null} the section, or null when absent
 */
export const specSection = (files = {}, budget = SPEC_BUDGET) => {
  const body = files?.[SPEC_PATH]
  if (typeof body !== 'string' || body === '') return null
  if (body.length <= budget) return `${SPEC_HEADER}\n\n${body}`
  const tail = body.slice(body.length - budget)
  const at = tail.indexOf('\n')
  const kept = at === -1 ? tail : tail.slice(at + 1)
  return `${SPEC_HEADER}\n\n${TRUNCATED(kept.length, body.length)}${kept}`
}
