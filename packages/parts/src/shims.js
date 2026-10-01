import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// A require of a module file that only `use`s its size list gets no sizes; the shim includes both, prelude first.
export const shimSource = (record) => [...(record.prelude ?? []), record.file].map((f) => `include <${f}>`).join('\n') + '\n'

export function writeShims(records, libsDir) {
  for (const record of records) {
    if (!record.prelude) continue
    const dest = join(libsDir, '_catalog', record.file)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, shimSource(record))
  }
}
