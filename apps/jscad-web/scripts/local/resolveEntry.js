// Resolves which model file to open when `jscad` starts in a model directory.
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const resolveEntry = async (modelDir, opts = {}) => {
  const readDir = opts.readDir ?? (() => readdir(modelDir))
  const readJson = opts.readJson ?? (async (p) => JSON.parse(await readFile(join(modelDir, p), 'utf-8')))
  if (opts.explicitFile) return { entryFile: opts.explicitFile, urlPath: `/models/${opts.explicitFile}` }
  const names = await readDir()
  if (names.includes('package.json')) {
    try {
      const pkg = await readJson('package.json')
      if (pkg?.main && names.includes(pkg.main)) return { entryFile: pkg.main, urlPath: `/models/${pkg.main}` }
    } catch { /* fall through */ }
  }
  if (names.includes('index.js')) return { entryFile: 'index.js', urlPath: '/models/index.js' }
  const dirName = `${basename(modelDir)}.js`
  if (names.includes(dirName)) return { entryFile: dirName, urlPath: `/models/${dirName}` }
  const first = names.filter((n) => n.endsWith('.js')).sort()[0]
  if (first) return { entryFile: first, urlPath: `/models/${first}` }
  throw new Error(`jscad: no entry in ${modelDir} (need package.json main, index.js, <dirname>.js or any *.js)`)
}
