import { describe, expect, it } from 'vitest'
import { buildMessages, CONTEXT_BUDGET, EMPTY_PROJECT, PROJECT_NOTE } from '../src/context.js'

const turn = (n, size) => [
  { role: 'user', content: `u${n}`.padEnd(size / 2, '.') },
  { role: 'assistant', content: `a${n}`.padEnd(size / 2, '.') },
]
const heads = (messages) => messages.map((m) => m.content.slice(0, 2))
const three = [...turn(1, 100), ...turn(2, 100), ...turn(3, 100)]

describe('buildMessages', () => {
  it('uses a 24,000 character budget by default', () => {
    expect(CONTEXT_BUDGET).toBe(24_000)
  })

  it('keeps the newest whole turns that fit', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 200 }))).toEqual(['S', 'u2', 'a2', 'u3', 'a3', 'Th', 'ne'])
  })

  it('keeps a turn that lands exactly on the budget', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 300 }))).toEqual(['S', 'u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'Th', 'ne'])
  })

  it('drops a turn whole rather than splitting it', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 250 }))).toEqual(['S', 'u2', 'a2', 'u3', 'a3', 'Th', 'ne'])
  })

  it('stops at the first turn that does not fit', () => {
    const transcript = [...turn(1, 10), ...turn(2, 500), ...turn(3, 10)]
    expect(heads(buildMessages({ systemPrompt: 'S', transcript, message: 'new', budget: 100 }))).toEqual(['S', 'u3', 'a3', 'Th', 'ne'])
  })

  it('always sends the new message, even past the budget', () => {
    expect(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 0 })).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: EMPTY_PROJECT },
      { role: 'user', content: 'new' },
    ])
  })

  it('counts a user message without a reply as its own turn', () => {
    const transcript = [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }, { role: 'assistant', content: 'z' }]
    expect(heads(buildMessages({ systemPrompt: 'S', transcript, message: 'new', budget: 2 }))).toEqual(['S', 'y', 'z', 'Th', 'ne'])
  })

  it('puts project files after the history, outside the budget, sorted by path', () => {
    const messages = buildMessages({ systemPrompt: 'S', transcript: three, files: { 'b.js': 'B', 'a.js': 'A' }, message: 'new', budget: 0 })
    expect(messages).toHaveLength(3)
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('### a.js\n\n```js\nA\n```')
    expect(messages[1].content.indexOf('### a.js')).toBeLessThan(messages[1].content.indexOf('### b.js'))
    expect(messages[2]).toEqual({ role: 'user', content: 'new' })
  })

  it('says an empty project is empty, so the model need not list it', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', message: 'new' })
    expect(project).toEqual({ role: 'user', content: `The project is empty; no build yet.\n\n${PROJECT_NOTE}` })
    expect(PROJECT_NOTE).toBe('Every message comes with this note on the project: its text files and its last build, so list is rarely needed.')
  })

  it('ends every project note saying it comes with every message', () => {
    const build = { ok: true, entry: 'main.js', warnings: [], console: [], params: [] }
    for (const [files, b] of [[{}, null], [{ 'main.js': 'M' }, null], [{ 'main.js': 'M' }, build], [{ 'part.stl': new ArrayBuffer(4) }, null]]) {
      expect(buildMessages({ systemPrompt: 'S', files, build: b, message: 'new' })[1].content.endsWith(`\n\n${PROJECT_NOTE}`)).toBe(true)
    }
  })

  it('skips binary files and says when no text file is left', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'part.stl': new ArrayBuffer(4) }, message: 'new' })
    expect(project.content).toBe(`The project has no text files; list shows every file.\n\nThe project has not been built yet.\n\n${PROJECT_NOTE}`)
  })

  it('fences a file containing backticks with a longer fence', () => {
    const [, files] = buildMessages({ systemPrompt: 'S', files: { 'n.md': 'a\n```\nb' }, message: 'new' })
    expect(files.content).toContain('````md\na\n```\nb\n````')
  })

  it('adds the last build report after the files', () => {
    const build = { ok: false, entry: 'main.js', error: { message: 'boom', file: 'main.js', line: 2, column: 3 }, warnings: [], console: [], params: [] }
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'main.js': 'M' }, build, message: 'new' })
    expect(project.content).toContain('### main.js')
    expect(project.content).toContain(`Last build of the project:\n\n\`\`\`json\n${JSON.stringify(build)}\n\`\`\``)
    expect(project.content.indexOf('### main.js')).toBeLessThan(project.content.indexOf('Last build'))
  })

  it('says when the project has not been built', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'main.js': 'M' }, message: 'new' })
    expect(project.content).not.toContain('Last build')
    expect(project.content).toContain('The project has not been built yet.')
  })
})
