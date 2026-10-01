import { API_PROSE, EXAMPLES, PARTS, PROSE, SHEETS } from '../prompt/index.js'
import { APIS, checkApi, DEFAULT_API } from './api.js'

const fenced = (source) => `\`\`\`javascript\n${source.trim()}\n\`\`\``

// An API file holds its import table rows, then its style section from its
// first `## ` heading on; the shared prose has one slot for each.
const splitApiProse = (text) => {
  const at = text.indexOf('\n## ')
  return { imports: text.slice(0, at).trim(), style: text.slice(at).trim() }
}

// partsBlock is generated and empty until the catalog has admitted entries
// (parts/bin/build.js); an empty block adds no heading and no blank section.
export const assemblePrompt = (prose, apiProse, sheet, examples, partsBlock = '') => {
  const { imports, style } = splitApiProse(apiProse)
  const filled = prose.trim().replace('{{imports}}', imports).replace('{{style}}', style)
  const sections = [filled, sheet.trim(), ...(partsBlock.trim() ? [partsBlock.trim()] : []), '## Examples', ...examples.map(({ source }) => fenced(source))]
  return `${sections.join('\n\n')}\n`
}

const PROMPTS = Object.fromEntries(APIS.map((api) => [api, assemblePrompt(PROSE, API_PROSE[api], SHEETS[api], EXAMPLES[api], PARTS)]))

export const buildSystemPrompt = (api = DEFAULT_API) => PROMPTS[checkApi(api)]
