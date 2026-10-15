import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The docs are user-facing: a stale tool name here misleads a reader the same
// way a stale name in the prompt misleads the model.
const doc = readFileSync(new URL('../docs/standard-tools.md', import.meta.url), 'utf8')

const row = (tool) => doc.split('\n').find((line) => line.trim().startsWith(`| \`${tool}\` |`))

describe('standard-tools.md', () => {
  it('maps the shipped tools to their OpenCode names', () => {
    for (const name of ['read', 'write', 'edit']) {
      expect(row(name), name).toMatch(new RegExp(`\\| \`${name}\` \\| \`${name}\` \\|`))
    }
    for (const name of ['glob', 'grep', 'question', 'websearch', 'execute']) {
      expect(row(name), name).toMatch(new RegExp(`\\| \`${name}\` \\| \`${name}\` \\|`))
    }
  })

  it('names the old name each renamed tool replaces', () => {
    expect(row('glob')).toContain('`list`')
    expect(row('grep')).toContain('`search`')
    expect(row('question')).toContain('`ask_user`')
    expect(row('websearch')).toContain('`web_search`')
    expect(row('execute')).toContain('`run`')
  })

  it('marks the domain-only tools as extensions', () => {
    for (const name of ['delete', 'measure', 'check', 'export', 'docs', 'view']) {
      expect(row(name), name).toMatch(/extension/i)
    }
  })

  it('covers webfetch, and names the OpenCode tools left out or deferred', () => {
    expect(row('webfetch')).toContain('webfetch')
    expect(doc).toMatch(/\bshell\b/)
    expect(doc).toMatch(/\bpatch\b/)
    expect(doc).toMatch(/\bskill\b/)
    expect(doc).toMatch(/\bsubagent\b/)
    expect(doc).toMatch(/out|deferred/i)
  })

  it('keeps no stale tool name in the what-we-have table', () => {
    const table = doc.slice(doc.indexOf('## What we have'), doc.indexOf('## Standard tools we lack'))
    expect(table).not.toMatch(/`list`|`search`|`ask_user`|`web_search`|`run`/)
  })
})
