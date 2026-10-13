// Retained helper: size the built system prompt per API. The skills-split
// verdict is recorded in standard-tools.md #6; keep this to re-check on change.
import { buildSystemPrompt } from '../src/prompt.js'
import { estimateTokens } from '../api/sheet.js'

for (const api of ['fluent', 'modeling']) {
  const prompt = buildSystemPrompt(api)
  const words = prompt.split(/\s+/).length
  console.log(api, 'chars:', prompt.length, 'words~tokens:', words, 'tokens:', estimateTokens(prompt))
}
