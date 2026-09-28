import { EXAMPLES, PROSE } from '../prompt/index.js'

const fenced = (source) => `\`\`\`javascript\n${source.trim()}\n\`\`\``

export const assemblePrompt = (prose, examples) =>
  `${[prose.trim(), '## Examples', ...examples.map(({ source }) => fenced(source))].join('\n\n')}\n`

export const SYSTEM_PROMPT = assemblePrompt(PROSE, EXAMPLES)
