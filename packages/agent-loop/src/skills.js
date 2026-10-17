/**
 * Max characters of a skill body served to the model; longer bodies are capped.
 */
export const SKILL_BUDGET = 2000

const TRUNCATED = '\n[truncated: skill body exceeds budget]'

const cap = (text) => (text.length <= SKILL_BUDGET ? text : text.slice(0, SKILL_BUDGET - TRUNCATED.length) + TRUNCATED)

// The `description:` line of a body's frontmatter block, or '' when none.
const parseDescription = (body) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  if (!match) return ''
  const line = match[1].split(/\r?\n/).find((l) => l.trimStart().startsWith('description:'))
  return line ? line.slice(line.indexOf('description:') + 'description:'.length).trim() : ''
}

/**
 * List each skill id with its frontmatter description, for the prompt index.
 * @param {Record<string,string>} index kebab-case id to raw markdown body
 * @returns {Array<{id:string,description:string}>}
 */
export const skillIndex = (index) => Object.entries(index ?? {}).map(([id, body]) => ({ id, description: parseDescription(body) }))

/**
 * Look up a skill body by id. A miss is a result, never a throw, so the loop
 * always has something to hand back to the model.
 * @param {Record<string,string>} index kebab-case id to raw markdown body
 * @param {string} name the skill id
 * @returns {string} the body within SKILL_BUDGET, or toolError JSON on a miss
 */
export const lookupSkill = (index, name) => {
  const body = index?.[name]
  if (typeof body !== 'string') {
    return JSON.stringify({ ok: false, error: { name: 'NotFoundError', message: `no skill ${name}; available: ${Object.keys(index ?? {}).join(', ')}` } })
  }
  return cap(body)
}

/**
 * Serve the skill tool: the tool arg (a name or its args object) answers the
 * skill body, or toolError JSON on a miss.
 * @param {Record<string,string>} index kebab-case id to raw markdown body
 * @param {string|{name?:string,id?:string}} name the skill id, or the tool args
 * @returns {string} the body within SKILL_BUDGET, or toolError JSON on a miss
 */
export const skillTool = (index, name) => lookupSkill(index, typeof name === 'object' && name !== null ? name.name ?? name.id : name)
