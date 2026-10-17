import { API_PROSE, EXAMPLES, PARTS, PROSE, SHEETS, SKILLS } from '../prompt/index.js'
import { APIS, checkApi, DEFAULT_API } from './api.js'
import { skillIndex } from './skills.js'

const fenced = (source) => `\`\`\`javascript\n${source.trim()}\n\`\`\``

// An API file holds its import table rows, then its style section from its
// first `## ` heading on; the shared prose has one slot for each.
const splitApiProse = (text) => {
  const at = text.indexOf('\n## ')
  return { imports: text.slice(0, at).trim(), style: text.slice(at).trim() }
}

/**
 * Index-only skill lines for the system prompt: each id with its frontmatter
 * description, so the model knows when each applies. Bodies stay out; the
 * model loads one with the `skill` tool.
 * @returns {string} the Skills section
 */
export const skillsSection = () => {
  const lines = skillIndex(SKILLS).map(({ id, description }) => `- \`${id}\`: ${description}`)
  return `## Skills\n\nLoad the full procedure with \`skill\` when its line applies; bodies stay out of the prompt:\n\n${lines.join('\n')}`
}

/**
 * Pointer to the per-turn notes index. Project notes ride each turn in the
 * project message, so the static system prompt carries only this line naming
 * their `Project notes:` header index.
 */
export const NOTES_POINTER = 'Project notes arrive each turn as a `Project notes:` index of headers; read the full file with `read`.'

// partsBlock is generated and empty until the catalog has admitted entries
// (parts/bin/build.js); an empty block adds no heading and no blank section.
export const assemblePrompt = (prose, apiProse, sheet, examples, partsBlock = '') => {
  const { imports, style } = splitApiProse(apiProse)
  const filled = prose.trim().replace('{{imports}}', imports).replace('{{style}}', style)
  const sections = [filled, skillsSection(), NOTES_POINTER, sheet.trim(), ...(partsBlock.trim() ? [partsBlock.trim()] : []), '## Examples', ...examples.map(({ source }) => fenced(source))]
  return `${sections.join('\n\n')}\n`
}

const PROMPTS = Object.fromEntries(APIS.map((api) => [api, assemblePrompt(PROSE, API_PROSE[api], SHEETS[api], EXAMPLES[api], PARTS)]))

export const buildSystemPrompt = (api = DEFAULT_API) => PROMPTS[checkApi(api)]
