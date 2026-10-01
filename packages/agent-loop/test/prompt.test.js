import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { APIS, DEFAULT_API } from '../src/api.js'
import { assemblePrompt, buildSystemPrompt } from '../src/prompt.js'
import { EXAMPLES } from '../prompt/index.js'
import { createEvalBackend } from '../eval/backend.js'

const exampleDir = (api) => new URL(`../prompt/examples/${api}/`, import.meta.url)
const filesOf = (api) => readdirSync(exampleDir(api)).filter((f) => f.endsWith('.js')).sort()
const read = (api, file) => readFileSync(new URL(file, exampleDir(api)), 'utf8')
const request = (api, file) => read(api, file).split('\n')[0]
const lines = (text, needle) => text.split('\n').filter((l) => l.includes(needle))

const examples = APIS.flatMap((api) => filesOf(api).map((file) => [api, file]))

describe('system prompt', () => {
  it('defaults to the fluent API', () => {
    expect(DEFAULT_API).toBe('fluent')
    expect(buildSystemPrompt()).toBe(buildSystemPrompt('fluent'))
  })

  it('refuses an unknown API', () => {
    expect(() => buildSystemPrompt('openscad')).toThrow(/unknown api openscad/)
  })

  it.each(APIS)('%s: lists its example files in file-name order', (api) => {
    expect(EXAMPLES[api].map((e) => e.file)).toEqual(filesOf(api))
  })

  it.each(APIS)('%s: carries its own examples after the Examples heading, in order, and no others', (api) => {
    const prompt = buildSystemPrompt(api)
    let at = prompt.indexOf('## Examples')
    expect(at).toBeGreaterThan(0)
    for (const file of filesOf(api)) {
      const next = prompt.indexOf(read(api, file).trim(), at)
      expect(next).toBeGreaterThan(at)
      at = next
    }
    const other = APIS.find((a) => a !== api)
    for (const file of filesOf(other)) expect(prompt).not.toContain(read(other, file).trim())
  })

  it('covers the same requests in both styles', () => {
    expect(filesOf('modeling').map((f) => request('modeling', f))).toEqual(filesOf('fluent').map((f) => request('fluent', f)))
  })

  it.each(examples)('%s/%s opens with a one-line comment naming its request, not the API', (_api, file) => {
    const first = request(_api, file)
    expect(first).toMatch(/^\/\/ \S/)
    expect(first).not.toMatch(/fluent|modeling/i)
  })

  it.each(examples)('%s/%s imports only its own API', (api, file) => {
    const source = read(api, file)
    if (api === 'fluent') expect(source).not.toContain('@jscad/modeling')
    else expect(source).not.toMatch(/fluent|\bjf\b/)
  })

  it.each(examples)('%s/%s builds in the eval backend with no option warnings', async (api, file) => {
    const res = JSON.parse(await createEvalBackend({ api }).requestTool('write', { path: 'main.js', content: read(api, file) }))
    expect(res).toMatchObject({ ok: true, warnings: [] })
  })

  it.each(APIS)('%s: keeps @jscadui/jscad-text', (api) => {
    expect(buildSystemPrompt(api)).toContain("const jscadText = require('@jscadui/jscad-text')")
  })

  it('fluent: names @jscad/modeling only to rule it out', () => {
    const mentions = lines(buildSystemPrompt('fluent'), '@jscad/modeling')
    expect(mentions.length).toBeGreaterThan(0)
    for (const line of mentions) expect(line).toMatch(/Do not require/)
  })

  it.each(APIS)('%s: replies once a build meets the request', (api) => {
    expect(buildSystemPrompt(api)).toMatch(/Once a build meets the request, reply; refine further only when the user\s+asks\./)
  })

  it.each(APIS)('%s: says jscad-text needs no init', (api) => {
    const prompt = buildSystemPrompt(api)
    expect(prompt).toContain('with no `init` needed')
    expect(prompt).not.toContain('jscadText.init(')
  })

  it('fluent: teaches one method chain per shape and no modeling calls', () => {
    const prompt = buildSystemPrompt('fluent')
    expect(prompt).toMatch(/one method chain per logical shape/)
    expect(prompt).toMatch(/Name a part in a local only when the name makes the\s+model clearer/)
    expect(prompt).toMatch(/Do not require `@jscad\/modeling`/)
  })

  it('modeling: never mentions jscad-fluent', () => {
    expect(buildSystemPrompt('modeling')).not.toMatch(/fluent|\bjf\b/i)
  })

  it('modeling: says geometry is plain data passed to functions', () => {
    expect(buildSystemPrompt('modeling')).toMatch(/no methods/)
  })

  it.each(APIS)('%s: tells the model to look up options with docs', (api) => {
    expect(buildSystemPrompt(api)).toMatch(/- Look up an unfamiliar function's options and defaults with `docs` before\s+using it\./)
  })

  it.each(APIS)('%s: explains the project layout and its entry rule', (api) => {
    expect(buildSystemPrompt(api)).toMatch(/the file `package\.json` names in\s+`main`, else `index\.js`, else `main\.js`/)
  })

  it.each(APIS)('%s: teaches the project tools, with no save step and no old tools', (api) => {
    const prompt = buildSystemPrompt(api)
    for (const tool of ['edit', 'write', 'run', 'measure', 'check', 'docs']) expect(prompt).toContain(`\`${tool}\``)
    expect(prompt).toMatch(/Every `write` and `edit` saves the file and builds the project/)
    expect(prompt).not.toMatch(/writeModel|notSaved|`eval`|[Ss]ave with|save often/)
  })

  it.each(APIS)('%s: keeps the millimetre line', (api) => {
    expect(buildSystemPrompt(api)).toContain('Model in millimetres; 1 inch = 25.4 mm.')
  })

  it.each(APIS)('%s: fills every slot of the shared prose', (api) => {
    expect(buildSystemPrompt(api)).not.toMatch(/\{\{\w+\}\}/)
  })
})

describe('assemblePrompt Parts block', () => {
  const prose = 'Prose {{imports}} end. {{style}}'
  const apiProse = 'IMPORT_TABLE\n## Style\nStyle text'
  const sheet = 'SHEET'
  const examples = [{ source: 'console.log(1)' }]

  it('adds no heading and no blank section for an empty block', () => {
    const prompt = assemblePrompt(prose, apiProse, sheet, examples, '')
    expect(prompt).not.toContain('## Parts')
    expect(prompt).not.toMatch(/\n\n\n/)
  })

  it('defaults to no Parts block when none is given', () => {
    expect(assemblePrompt(prose, apiProse, sheet, examples)).not.toContain('## Parts')
  })

  it('carries a non-empty Parts block between the sheet and the examples', () => {
    const parts = '## Parts\n\n- nut: `const { nut } = require(\'A/nuts.scad\')` — nut(M3_nut)\n\nRules:\n- Use a catalog part for standard hardware instead of modeling it.'
    const prompt = assemblePrompt(prose, apiProse, sheet, examples, parts)
    const sheetAt = prompt.indexOf('SHEET')
    const partsAt = prompt.indexOf('## Parts')
    const examplesAt = prompt.indexOf('## Examples')
    expect(partsAt).toBeGreaterThan(sheetAt)
    expect(examplesAt).toBeGreaterThan(partsAt)
    expect(prompt).toContain('Use a catalog part for standard hardware instead of modeling it.')
  })
})
