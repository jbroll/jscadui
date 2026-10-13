// Temporary spike: size the built system prompt per API to decide whether the
// skills split (standard-tools.md #6) is needed. Delete once the verdict lands.
import { buildSystemPrompt } from '../src/prompt.js'
import { estimateTokens } from '../api/sheet.js'

for (const api of ['fluent', 'modeling']) {
  const prompt = buildSystemPrompt(api)
  const words = prompt.split(/\s+/).length
  console.log(api, 'chars:', prompt.length, 'words~tokens:', words, 'tokens:', estimateTokens(prompt))
}
