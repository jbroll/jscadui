import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const RAW = '?raw'

export const rawImportPlugin = {
  name: 'raw-import',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -RAW.length)), namespace: 'raw' }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
      watchFiles: [args.path],
    }))
  },
}
