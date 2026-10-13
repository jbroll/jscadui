import { test, expect } from 'vitest'
import { execSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIND = 'instanceof\\s+(geom3|geom2|ManifoldGeom3|ManifoldGeom2|Ghosts)|new\\s+WeakMap'
// allow-list: [file substring, regex source matching permitted lines in that file]
// Complete list of identity-check sites as of the tree-nodes work; every entry
// must match at least one real line or the test fails. Add a tag predicate
// before adding a site here (spec: "Tree namespace and read policy").
const ALLOW = [
  ['openscad-runtime/src/overlay.js', 'table = new WeakMap'],
  ['openscad-runtime/src/overlay.js', 'instanceof Ghosts'],
]

test('no unlisted geometry identity checks', () => {
  // git grep covers tracked packages; plain grep covers the gitignored .deps-cache checkouts
  const tracked = execSync(`git grep -n -E "${FIND}" -- packages/openscad-runtime packages/manifold 2>/dev/null || true`, { encoding: 'utf8', cwd: ROOT })
  const cache = execSync(`grep -rn -E "${FIND}" .deps-cache/jscad-anchors/src .deps-cache/jscad-fluent/src 2>/dev/null || true`, { encoding: 'utf8', cwd: ROOT })
  const lines = (tracked + '\n' + cache).trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const ok = ALLOW.some(([file, re]) => line.includes(file) && new RegExp(re).test(line))
    expect(ok, line).toBe(true)
  }
  for (const [file, re] of ALLOW) {
    const found = lines.some((line) => line.includes(file) && new RegExp(re).test(line))
    expect(found, `allow-listed site missing: ${file} ${re}`).toBe(true)
  }
})
