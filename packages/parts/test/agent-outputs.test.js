import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildAgentDocs, buildCatalog } from '../bin/build.js'
import { readRecords } from '../src/records.js'

const AGENT_API_PARTS_PATH = fileURLToPath(new URL('../../agent-loop/api/parts.json', import.meta.url))
const AGENT_PROMPT_PARTS_PATH = fileURLToPath(new URL('../../agent-loop/prompt/parts.md', import.meta.url))
const DERIVED_PATH = fileURLToPath(new URL('../derived.json', import.meta.url))

// derived.json is not committed (Task 12's admission step); read it the same
// way bin/build.js does, so this matches whatever a real build would write.
function readDerived() {
  try {
    return JSON.parse(readFileSync(DERIVED_PATH, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return {}
  }
}

describe('agent docs freshness', () => {
  it('regenerating api/parts.json and prompt/parts.md matches the committed files', () => {
    const { entries } = buildCatalog(readRecords(), readDerived())
    const { json, md } = buildAgentDocs(entries)
    expect(readFileSync(AGENT_API_PARTS_PATH, 'utf8')).toBe(JSON.stringify(json, null, 2) + '\n')
    expect(readFileSync(AGENT_PROMPT_PARTS_PATH, 'utf8')).toBe(md)
  })
})
