import { hasImages, imageLabel } from './userImages.js'

export const SUMMARY_PREFIX = 'Summary of earlier work in this chat:\n\n'
export const MAX_SUMMARY_CHARS = 2000

const trunc = (content) =>
  typeof content === 'string' && content.length > MAX_SUMMARY_CHARS
    ? `${content.slice(0, MAX_SUMMARY_CHARS)}\n… [truncated ${content.length - MAX_SUMMARY_CHARS} chars]`
    : content

const turnText = (turn) =>
  turn
    .map((m) => {
      const who = m.role === 'assistant' ? 'Assistant' : 'User'
      const calls = (m.toolCalls ?? []).map((c) => `${c.name}(${JSON.stringify(c.input ?? {})})`).join(', ')
      const mentions = (m.mentions ?? []).filter((p) => typeof p === 'string').join(', ')
      const images = hasImages(m) ? ` ${m.images.map(imageLabel).join(' ')}` : ''
      return `${who}: ${trunc(m.content ?? '')}${images}${calls ? `\nTools: ${calls}` : ''}${mentions ? `\nFiles touched: ${mentions}` : ''}`
    })
    .join('\n')

export const buildSummaryPrompt = (turns, priorSummary = '') =>
  [
    'Summarize this CAD chat for a fresh model taking over. Cover: goal, decisions, completed and active work, files touched.',
    priorSummary ? `Previous summary:\n${priorSummary}` : null,
    `Transcript:\n${turns.map(turnText).join('\n---\n')}`,
    'Reply with the updated summary only, under 1500 characters.',
  ]
    .filter(Boolean)
    .join('\n\n')

export const summarizeTranscript = async ({ turns, priorSummary = '' }, callModel) => {
  if (turns.length === 0) return priorSummary
  return callModel(buildSummaryPrompt(turns, priorSummary))
}

export const summarizeWithProvider = (provider) => async (prompt) => {
  const parts = []
  const iterator = provider.send([{ role: 'user', content: prompt }], [])[Symbol.asyncIterator]()
  for (;;) {
    const { done, value } = await iterator.next()
    if (done) break
    if (value?.type === 'text') parts.push(value.text)
    else if (value?.type === 'done') break
  }
  await iterator.return?.(undefined).catch(() => {})
  return parts.join('')
}
