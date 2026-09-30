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

// `build` is the project's last build report (src/buildReport.js), or null.
export const projectMessage = (files = {}, build = null) => {
  const sections = [filesSection(files), build ? `Last build of the project:\n\n\`\`\`json\n${JSON.stringify(build)}\n\`\`\`` : null].filter(Boolean)
  return sections.length > 0 ? { role: 'user', content: sections.join('\n\n') } : null
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
  const project = projectMessage(files, build)
  return [{ role: 'system', content: systemPrompt }, ...kept, ...(project ? [project] : []), { role: 'user', content: message }]
}
