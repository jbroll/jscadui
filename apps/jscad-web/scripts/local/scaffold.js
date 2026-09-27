// Writes a starter model into an empty model directory so `jscad-chat`
// always has something to open. Never overwrites: returns null when the
// directory already holds an entry file.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STARTER = `// Starter model created by jscad-chat. Edit freely.
const { cube } = require('@jscad/modeling').primitives

const getParameterDefinitions = () => [
  { name: 'size', type: 'float', initial: 10, caption: 'Size (mm)' },
]

const main = ({ size }) => cube({ size })

module.exports = { main, getParameterDefinitions }
`

export const scaffoldStarter = (modelDir) => {
  const names = readdirSync(modelDir)
  if (names.some((n) => n.endsWith('.js')) || names.includes('package.json')) return null
  const entryFile = 'index.js'
  if (!existsSync(join(modelDir, entryFile))) writeFileSync(join(modelDir, entryFile), STARTER)
  return { entryFile, created: true }
}
