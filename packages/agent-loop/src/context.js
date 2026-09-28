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

export const filesMessage = (files = {}) => {
  const entries = Object.entries(files)
    .filter(([, content]) => typeof content === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null
  const blocks = entries.map(([path, content]) => {
    const f = fence(content)
    return `### ${path}\n\n${f}${path.split('.').pop()}\n${content}\n${f}`
  })
  return { role: 'user', content: `Current project files:\n\n${blocks.join('\n\n')}` }
}

export const buildMessages = ({ systemPrompt, transcript = [], files = {}, message, budget = CONTEXT_BUDGET }) => {
  const kept = []
  let used = 0
  for (const turn of turnsOf(transcript).reverse()) {
    const size = sizeOf(turn)
    if (used + size > budget) break
    used += size
    kept.unshift(...turn)
  }
  const project = filesMessage(files)
  return [{ role: 'system', content: systemPrompt }, ...kept, ...(project ? [project] : []), { role: 'user', content: message }]
}
