import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))

export const loadScenarios = async () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js')
  const modules = await Promise.all(files.map((f) => import(new URL(f, import.meta.url).href)))
  return modules
    .map((mod) => mod.scenario)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}
