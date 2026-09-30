// Resolves which model file to open when `jscad` starts in a model directory.
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pickEntry } from '@jscadui/agent-loop/src/project.js'

export const resolveEntry = async (modelDir, opts = {}) => {
  const readDir = opts.readDir ?? (() => readdir(modelDir))
  const readText = opts.readText ?? ((p) => readFile(join(modelDir, p), 'utf-8'))
  if (opts.explicitFile) return { entryFile: opts.explicitFile, urlPath: `/models/${opts.explicitFile}` }
  const names = await readDir()
  const packageJson = names.includes('package.json') ? await readText('package.json').catch(() => undefined) : undefined
  const entryFile = pickEntry(names, { folder: basename(modelDir), packageJson, anyJs: true })
  if (entryFile) return { entryFile, urlPath: `/models/${entryFile}` }
  throw new Error(`jscad: no entry in ${modelDir} (need package.json main, index.js, index.ts, main.js, <dirname>.js or any *.js)`)
}
