import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEvalBackend } from './backend.js'
import { KEYLESS_SOURCES } from './keyless.js'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const FLUENT = /require\(\s*['"]@jbroll\/jscad-fluent['"]\s*\)/
const EXAMPLE_DIRS = ['apps/jscad-web/examples', 'packages/agent-loop/prompt/examples']

const jsFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(dir, f)) : []

const corpus = () => [
  ...EXAMPLE_DIRS.flatMap((dir) => jsFiles(join(REPO, dir)))
    .map((file) => ({ name: relative(REPO, file), source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => FLUENT.test(source)),
  ...Object.entries(KEYLESS_SOURCES).map(([name, source]) => ({ name: `eval/keyless.js ${name}`, source })),
]

describe('fluent method checks on real models', () => {
  it('raise no warning on any fluent example', async () => {
    const skipped = []
    const warned = []
    let ran = 0
    for (const { name, source } of corpus()) {
      const res = JSON.parse(await createEvalBackend().requestTool('write', { path: 'main.js', content: source }))
      if (!res.ok) {
        skipped.push(`${name}: ${res.error.message}`)
        continue
      }
      ran += 1
      if (res.warnings.length) warned.push({ name, warnings: res.warnings })
    }
    if (skipped.length) console.warn(`fluent guard skipped ${skipped.length}:\n${skipped.join('\n')}`)
    expect(warned).toEqual([])
    expect(ran).toBeGreaterThanOrEqual(5)
  }, 120_000)
})
