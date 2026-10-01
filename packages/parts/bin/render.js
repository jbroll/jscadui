import { mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRenderer } from '@jscadui/agent-loop/eval/render.js'
import { readRecords, CATALOG_DIR } from '../src/records.js'
import { loadEntry, buildPart, LIBS_DIR } from '../src/load.js'
import { toRenderParts } from '../src/triangles.js'

const THUMBS_DIR = fileURLToPath(new URL('../thumbs/', import.meta.url))

export async function renderRecord(record, renderer, { libsDir, outDir = THUMBS_DIR } = {}) {
  const loaded = await loadEntry(record, { libsDir })
  const [check] = record.checks
  const { geometry } = await buildPart(loaded, record, check.args)
  const parts = toRenderParts(geometry, loaded.ctx)
  const work = mkdtempSync(join(tmpdir(), 'jscadui-parts-render-'))
  try {
    const [view] = await renderer.render(parts, work)
    const dest = join(outDir, `${record.id}.png`)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(view.path, dest)
    return dest
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  let catalogDir = CATALOG_DIR
  let libsDir = LIBS_DIR
  let outDir = THUMBS_DIR
  let all = false
  const ids = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--all') all = true
    else if (arg === '--catalog') catalogDir = args[++i]
    else if (arg === '--libs') libsDir = args[++i]
    else if (arg === '--out') outDir = args[++i]
    else ids.push(arg)
  }

  const records = readRecords(catalogDir)
  if (!all && ids.length === 0) {
    console.error('usage: render.js <id>... | --all [--catalog <dir>] [--libs <dir>] [--out <dir>]')
    process.exitCode = 1
    return
  }
  const selected = all ? records : records.filter((r) => ids.includes(r.id))
  const missing = all ? [] : ids.filter((id) => !records.some((r) => r.id === id))
  if (missing.length > 0) {
    console.error(`unknown record id(s): ${missing.join(', ')}`)
    process.exitCode = 1
    return
  }

  const renderer = await createRenderer()
  try {
    for (const record of selected) {
      const dest = await renderRecord(record, renderer, { libsDir, outDir })
      console.log(`${record.id} -> ${dest}`)
    }
  } finally {
    await renderer.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
