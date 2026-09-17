// The checked-in manifest must equal what the schema compiles to;
// regenerate with node scripts/gen-manifest.js when schema.js changes.
import { describe, expect, it } from 'vitest'
import { compileSchema } from '@jbroll/rowboat-schema'
import { manifest } from '../src/storage/manifest.js'
import { schema } from '../src/storage/schema.js'

describe('rowboat manifest parity', () => {
  it('matches the compiled schema', () => {
    expect(manifest).toEqual(compileSchema(schema).manifest)
  })
})
