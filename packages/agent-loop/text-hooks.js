import { readFile } from 'node:fs/promises'

const RAW = '?raw'

export async function load(url, context, nextLoad) {
  if (!url.endsWith(RAW)) return nextLoad(url, context)
  const text = await readFile(new URL(url.slice(0, -RAW.length)), 'utf8')
  return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)}` }
}
