export const NOTES_BUDGET = 2000

/**
 * Header opening the per-turn notes index in the project message.
 * @type {string}
 */
export const NOTES_HEADER = 'Project notes:\n\n'

const DESCRIPTION_CAP = 120

const capDescription = (text) => (text.length <= DESCRIPTION_CAP ? text : text.slice(0, DESCRIPTION_CAP))

/**
 * The one-line header of a note: frontmatter `description:` else the first
 * `#` line else the first non-empty line, capped to 120 characters.
 * @param {string} content the raw note file body
 * @returns {string} the description, or '' when the note is blank
 */
export const parseNoteDescription = (content) => {
  if (typeof content !== 'string') return ''
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content)
  if (frontmatter) {
    const line = frontmatter[1].split('\n').find((l) => l.startsWith('description:'))
    if (line && line.slice('description:'.length).trim()) return capDescription(line.slice('description:'.length).trim())
  }
  const lines = content.slice(frontmatter ? frontmatter[0].length : 0).split('\n')
  const heading = lines.find((l) => l.trimStart().startsWith('#'))
  if (heading) {
    const text = heading.replace(/^\s*#+\s*/, '').trim()
    if (text) return capDescription(text)
  }
  const first = lines.find((l) => l.trim())
  return first ? capDescription(first.trim()) : ''
}

/**
 * List each `notes/` markdown file with its header, for the prompt index.
 * Only `notes/**.md` files are indexed and anything else is skipped. The index
 * is capped to NOTES_BUDGET with names-only overflow, like `filesSection`.
 * @param {Record<string,string>} files project path to text content
 * @param {number} [budget] max characters for the index
 * @returns {string} the index, or '' when the project has no notes
 */
export const notesIndex = (files = {}, budget = NOTES_BUDGET) => {
  const entries = Object.entries(files ?? {})
    .filter(([path, content]) => typeof content === 'string' && path.startsWith('notes/') && path.endsWith('.md'))
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return ''
  const lines = entries.map(([path, content]) => {
    const description = parseNoteDescription(content)
    return description ? `- ${path}: ${description} (read the full file via read)` : `- ${path} (read the full file via read)`
  })
  const kept = []
  let size = 0
  for (const line of lines) {
    if (kept.length > 0 && size + 1 + line.length > budget) break
    kept.push(line)
    size = kept.length === 1 ? NOTES_HEADER.length + line.length : size + 1 + line.length
  }
  const body = `${NOTES_HEADER}${kept.join('\n')}`
  if (kept.length === lines.length) return body
  const omitted = entries.slice(kept.length).map(([path]) => `- ${path}`).join('\n')
  return `${body}\n\nOther notes (names only, read via read tool):\n${omitted}`
}
