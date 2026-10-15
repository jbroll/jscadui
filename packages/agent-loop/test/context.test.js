import { describe, expect, it } from 'vitest'
import { buildMessages, CONTEXT_BUDGET, EMPTY_PROJECT, partitionTranscript, PROJECT_BUDGET, PROJECT_NOTE } from '../src/context.js'
import { SUMMARY_PREFIX } from '../src/summarize.js'
import { mentionedPaths } from '../index.js'

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

  it('says an empty project is empty, so the model need not glob it', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', message: 'new' })
    expect(project).toEqual({ role: 'user', content: `The project is empty; no build yet.\n\n${PROJECT_NOTE}` })
    expect(PROJECT_NOTE).toBe('Every message comes with this note on the project: its text files and its last build, so glob is rarely needed.')
  })

  it('ends every project note saying it comes with every message', () => {
    const build = { ok: true, entry: 'main.js', warnings: [], console: [], params: [] }
    for (const [files, b] of [[{}, null], [{ 'main.js': 'M' }, null], [{ 'main.js': 'M' }, build], [{ 'part.stl': new ArrayBuffer(4) }, null]]) {
      expect(buildMessages({ systemPrompt: 'S', files, build: b, message: 'new' })[1].content.endsWith(`\n\n${PROJECT_NOTE}`)).toBe(true)
    }
  })

  it('skips binary files and says when no text file is left', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'part.stl': new ArrayBuffer(4) }, message: 'new' })
    expect(project.content).toBe(`The project has no text files; glob shows every file.\n\nThe project has not been built yet.\n\n${PROJECT_NOTE}`)
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

  it('partitions evicted and kept whole turns', () => {
    const { evicted, kept } = partitionTranscript(three, 200)
    expect(heads(kept)).toEqual(['u2', 'a2', 'u3', 'a3'])
    expect(heads(evicted)).toEqual(['u1', 'a1'])
  })

  it('prunes the oldest tool result instead of evicting a turn that fits without it', () => {
    const tool = (id, size) => ({ role: 'tool', toolCallId: id, content: 'x'.repeat(size) })
    const transcript = [
      { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, tool('t1', 100),
      { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }, tool('t2', 100),
      { role: 'user', content: 'u3' }, { role: 'assistant', content: 'a3' }, tool('t3', 100),
      { role: 'user', content: 'u4' }, { role: 'assistant', content: 'a4' }, tool('t4', 100),
    ]
    const { kept } = partitionTranscript(transcript, 360)
    expect(kept.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant', 'tool', 'user', 'assistant', 'tool', 'user', 'assistant', 'tool'])
    expect(kept[2].content).toBe('[Old tool result content cleared]')
    expect(kept[5].content).toHaveLength(100)
    expect(kept[8].content).toHaveLength(100)
    expect(kept[11].content).toHaveLength(100)
    expect(transcript[2].content).toHaveLength(100)
  })

  it('evicts whole turns once only the newest tool results are left full', () => {
    const tool = (id, size) => ({ role: 'tool', toolCallId: id, content: 'x'.repeat(size) })
    const transcript = [
      { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, tool('t1', 100),
      { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }, tool('t2', 100),
      { role: 'user', content: 'u3' }, { role: 'assistant', content: 'a3' }, tool('t3', 100),
      { role: 'user', content: 'u4' }, { role: 'assistant', content: 'a4' }, tool('t4', 100),
    ]
    const { evicted, kept } = partitionTranscript(transcript, 300)
    expect(kept.map((m) => (m.role === 'tool' ? m.toolCallId : m.content))).toEqual(['u3', 'a3', 't3', 'u4', 'a4', 't4'])
    expect(evicted.map((m) => (m.role === 'tool' ? m.toolCallId : m.content))).toEqual(['u1', 'a1', 't1', 'u2', 'a2', 't2'])
  })

  it('inserts the summary after the system message', () => {
    const messages = buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 200, summary: 'did stuff' })
    expect(messages[0]).toEqual({ role: 'system', content: 'S' })
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe(`${SUMMARY_PREFIX}did stuff`)
    expect(heads(messages.slice(2))).toEqual(['u2', 'a2', 'u3', 'a3', 'Th', 'ne'])
  })
})

describe('project files budget', () => {
  const mention = (path) => ({ role: 'assistant', content: '', toolCalls: [{ id: path, name: 'write', input: { path } }] })
  const three = { 'a.js': 'A'.repeat(10), 'b.js': 'B'.repeat(10), 'c.js': 'C'.repeat(10) }
  const mentioned = [mention('a.js'), mention('b.js'), mention('c.js')]

  it('gives the project files block its own 24,000 character budget', () => {
    expect(PROJECT_BUDGET).toBe(24_000)
  })

  it('drops the oldest-mentioned files first when the block is over its own budget', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', transcript: mentioned, files: three, message: 'new', projectBudget: 100 })
    expect(project.content).toContain('### b.js')
    expect(project.content).toContain('### c.js')
    expect(project.content).not.toContain('### a.js')
  })

  it('keeps the project note when the files block is trimmed', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', transcript: mentioned, files: three, message: 'new', projectBudget: 100 })
    expect(project.content.endsWith(`\n\n${PROJECT_NOTE}`)).toBe(true)
  })

  it('leaves every file in place when the block fits its budget', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'a.js': 'A', 'b.js': 'B' }, message: 'new' })
    expect(project.content).toContain('### a.js\n\n```js\nA\n```')
    expect(project.content).toContain('### b.js\n\n```js\nB\n```')
  })

  it('skips binary files when trimming the block', () => {
    const [, project] = buildMessages({ systemPrompt: 'S', files: { 'part.stl': new ArrayBuffer(4), 'main.js': 'M'.repeat(200) }, message: 'new', projectBudget: 40 })
    expect(project.content).toContain('### main.js')
    expect(project.content).not.toContain('### part.stl')
  })

  it('drops every file older than a mentioned one that does not fit', () => {
    const files = { 'a.js': 'A', 'b.js': 'B'.repeat(100), 'c.js': 'C' }
    const transcript = [mention('a.js'), mention('b.js'), mention('c.js')]
    const project = buildMessages({ systemPrompt: 'S', transcript, files, message: 'new', projectBudget: 100 }).at(-2)
    expect(project.content).toContain('### c.js')
    expect(project.content).not.toContain('### a.js')
  })

  it('ranks never-mentioned files after mentioned ones and alphabetically among themselves', () => {
    const files = { 'z.js': 'Z'.repeat(10), 'a.js': 'A'.repeat(10), 'm.js': 'M'.repeat(10) }
    const transcript = [{ role: 'user', content: 'start' }, mention('z.js')]
    const project = buildMessages({ systemPrompt: 'S', transcript, files, message: 'new', projectBudget: 90 }).at(-2)
    expect(project.content).toContain('### z.js')
    expect(project.content).toContain('### a.js')
    expect(project.content).not.toContain('### m.js')
  })

  it('ranks files by the mentions an assistant turn carries', () => {
    const byPath = (path) => ({ role: 'assistant', content: '', mentions: [path] })
    const transcript = [byPath('a.js'), byPath('b.js'), byPath('c.js')]
    const [, project] = buildMessages({ systemPrompt: 'S', transcript, files: three, message: 'new', projectBudget: 100 })
    expect(project.content).toContain('### b.js')
    expect(project.content).toContain('### c.js')
    expect(project.content).not.toContain('### a.js')
  })
})

describe('mentionedPaths', () => {
  it('is exported from the package entry', () => {
    expect(mentionedPaths([{ role: 'assistant', mentions: ['a.js'] }])).toEqual(['a.js'])
  })

  it('ignores a summary message that carries no mentions or tool calls', () => {
    const summary = { role: 'system', content: `${SUMMARY_PREFIX}did stuff`, text: 'did stuff', basis: 2 }
    expect(mentionedPaths([summary, { role: 'user', content: 'x', mentions: ['a.js'] }])).toEqual(['a.js'])
  })
})
