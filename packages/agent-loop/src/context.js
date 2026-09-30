export const CONTEXT_BUDGET = 24_000

const turnsOf = (transcript) => {
  const turns = []
  for (const m of transcript) {
    if (m.role === 'user') turns.push([m])
    else if (m.role === 'assistant' && turns.length > 0) turns.at(-1).push(m)
  }
  return turns
}

const sizeOf = (turn) => turn.reduce((n, m) => n + (m.content?.length ?? 0), 0)

const fence = (content) => '`'.repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)))

const filesSection = (files) => {
  const entries = Object.entries(files)
    .filter(([, content]) => typeof content === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null
  const blocks = entries.map(([path, content]) => {
    const f = fence(content)
    return `### ${path}\n\n${f}${path.split('.').pop()}\n${content}\n${f}`
  })
  return `Current project files:\n\n${blocks.join('\n\n')}`
}

// Models listed a project the note had just described, a round each.
export const PROJECT_NOTE = 'Every message comes with this note on the project: its text files and its last build, so list is rarely needed.'

export const EMPTY_PROJECT = `The project is empty; no build yet.\n\n${PROJECT_NOTE}`

// Sent every turn, so the model knows the project's state without a `list`.
// `build` is the project's last build report (src/buildReport.js), or null.
export const projectMessage = (files = {}, build = null) => {
  const listed = filesSection(files)
  if (!listed && !build && Object.keys(files).length === 0) return { role: 'user', content: EMPTY_PROJECT }
  const sections = [
    listed ?? (Object.keys(files).length > 0 ? 'The project has no text files; list shows every file.' : 'The project has no files.'),
    build ? `Last build of the project:\n\n\`\`\`json\n${JSON.stringify(build)}\n\`\`\`` : 'The project has not been built yet.',
    PROJECT_NOTE,
  ]
  return { role: 'user', content: sections.join('\n\n') }
}

export const buildMessages = ({ systemPrompt, transcript = [], files = {}, build = null, message, budget = CONTEXT_BUDGET }) => {
  const kept = []
  let used = 0
  for (const turn of turnsOf(transcript).reverse()) {
    const size = sizeOf(turn)
    if (used + size > budget) break
    used += size
    kept.unshift(...turn)
  }
  return [{ role: 'system', content: systemPrompt }, ...kept, projectMessage(files, build), { role: 'user', content: message }]
}
