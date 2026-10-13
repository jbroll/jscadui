import { SUMMARY_PREFIX } from './summarize.js'

export const CONTEXT_BUDGET = 24_000

// The project files ride outside the history budget; this bounds them on their own.
export const PROJECT_BUDGET = 24_000

const FILE_HEADER = 'Current project files:\n\n'

export const turnsOf = (transcript) => {
  const turns = []
  for (const m of transcript) {
    if (m.role === 'user') turns.push([m])
    else if ((m.role === 'assistant' || m.role === 'tool') && turns.length > 0) turns.at(-1).push(m)
  }
  return turns
}

const sizeOf = (turn) => turn.reduce((n, m) => n + (m.content?.length ?? 0), 0)

const fence = (content) => '`'.repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)))

const blockOf = (path, content) => {
  const f = fence(content)
  return `### ${path}\n\n${f}${path.split('.').pop()}\n${content}\n${f}`
}

// Paths the model touched, in order; the last mention of a file is the recent one.
export const mentionedPaths = (transcript) => {
  const paths = []
  for (const m of transcript) {
    for (const path of m.mentions ?? []) {
      if (typeof path === 'string') paths.push(path)
    }
    for (const call of m.toolCalls ?? []) {
      if (typeof call.input?.path === 'string') paths.push(call.input.path)
    }
  }
  return paths
}

const filesSection = (files, mentioned = [], budget = PROJECT_BUDGET) => {
  const entries = Object.entries(files).filter(([, content]) => typeof content === 'string')
  if (entries.length === 0) return null
  const recency = new Map()
  mentioned.forEach((path, i) => recency.set(path, i))
  const byRecency = [...entries].sort(([a], [b]) => {
    const ra = recency.get(a)
    const rb = recency.get(b)
    if (ra !== rb) return (rb ?? -1) - (ra ?? -1)
    return a.localeCompare(b)
  })
  const kept = []
  let size = 0
  for (const [path, content] of byRecency) {
    const block = blockOf(path, content)
    if (kept.length > 0 && size + 2 + block.length > budget) break
    kept.push([path, block])
    size = kept.length === 1 ? FILE_HEADER.length + block.length : size + 2 + block.length
  }
  kept.sort(([a], [b]) => a.localeCompare(b))
  return `${FILE_HEADER}${kept.map(([, block]) => block).join('\n\n')}`
}

// Models listed a project the note had just described, a round each.
export const PROJECT_NOTE = 'Every message comes with this note on the project: its text files and its last build, so list is rarely needed.'

export const EMPTY_PROJECT = `The project is empty; no build yet.\n\n${PROJECT_NOTE}`

// Sent every turn, so the model knows the project's state without a `list`.
// `build` is the project's last build report (src/buildReport.js), or null.
export const projectMessage = (files = {}, build = null, mentioned = [], budget = PROJECT_BUDGET) => {
  const listed = filesSection(files, mentioned, budget)
  if (!listed && !build && Object.keys(files).length === 0) return { role: 'user', content: EMPTY_PROJECT }
  const sections = [
    listed ?? (Object.keys(files).length > 0 ? 'The project has no text files; list shows every file.' : 'The project has no files.'),
    build ? `Last build of the project:\n\n\`\`\`json\n${JSON.stringify(build)}\n\`\`\`` : 'The project has not been built yet.',
    PROJECT_NOTE,
  ]
  return { role: 'user', content: sections.join('\n\n') }
}

// Whole turns that fit the history budget, newest first; the rest are evicted.
// Before a turn is evicted, the oldest tool results are pruned to a
// placeholder (their tool_use record stays), oldest first, keeping the newest
// few full; only then do whole turns go. The input is never mutated.
export const PRUNED_TOOL_RESULT = '[Old tool result content cleared]'

const KEPT_FULL_TOOL_RESULTS = 3

const pruneToolResults = (transcript, budget) => {
  let size = transcript.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  if (size <= budget) return transcript
  const pruned = [...transcript]
  for (;;) {
    const full = pruned.filter((m) => m.role === 'tool' && typeof m.content === 'string' && m.content !== PRUNED_TOOL_RESULT)
    if (size <= budget || full.length <= KEPT_FULL_TOOL_RESULTS) return pruned
    const oldest = full[0]
    const at = pruned.indexOf(oldest)
    size -= oldest.content.length - PRUNED_TOOL_RESULT.length
    pruned[at] = { ...oldest, content: PRUNED_TOOL_RESULT }
  }
}

export const partitionTranscript = (transcript, budget = CONTEXT_BUDGET) => {
  const pruned = pruneToolResults(transcript, budget)
  const turns = turnsOf(pruned)
  const kept = []
  let used = 0
  for (const turn of [...turns].reverse()) {
    const size = sizeOf(turn)
    if (used + size > budget) break
    used += size
    kept.unshift(...turn)
  }
  const keptSet = new Set(kept)
  const evicted = pruned.filter((m) => !keptSet.has(m))
  return { evicted, kept }
}

export const buildMessages = ({ systemPrompt, transcript = [], files = {}, build = null, message, budget = CONTEXT_BUDGET, projectBudget = PROJECT_BUDGET, summary = '' }) => {
  const { kept } = partitionTranscript(transcript, budget)
  const project = projectMessage(files, build, mentionedPaths(transcript), projectBudget)
  return [
    { role: 'system', content: systemPrompt },
    ...(summary ? [{ role: 'user', content: `${SUMMARY_PREFIX}${summary}` }] : []),
    ...kept,
    project,
    { role: 'user', content: message },
  ]
}
