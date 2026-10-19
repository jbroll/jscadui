import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLES = 'examples/jscad/jscad-examples'

// The pair `defaultProjectFiles` (src/projectFiles.js) stores in a fresh
// production project. A model directory that already holds .js files is never
// scaffolded by the launcher (scripts/local/scaffold.js).
export const productionDefaultFiles = (webDir) => ({
  'main.js': readFileSync(join(webDir, EXAMPLES, '01-two-cars.example.js'), 'utf8'),
  '02-hierarchical-car.example.js': readFileSync(join(webDir, EXAMPLES, '02-hierarchical-car.example.js'), 'utf8'),
})

export const seedModelDir = (dir, files) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
}
