import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// NopSCADlib-style split: a module file `use`s a separate size-list file, so
// a JS require of the module alone misses the sizes. The shim includes both,
// prelude first, so one require exposes both.
export const shimSource = (record) => [...(record.prelude ?? []), record.file].map((f) => `include <${f}>`).join('\n') + '\n'

export function writeShims(records, libsDir) {
  for (const record of records) {
    if (!record.prelude) continue
    const dest = join(libsDir, '_catalog', record.file)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, shimSource(record))
  }
}
