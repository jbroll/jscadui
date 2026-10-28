import { describe, it, expect } from 'vitest'
import { serializeSolids } from '../src_frame/serializeSolids.js'

const fakeSerializer = () => {
  const calls = []
  return {
    calls,
    serialize: (options, solids) => {
      calls.push({ options, solids })
      return ['header', new ArrayBuffer(solids.length)]
    },
  }
}

describe('serializeSolids', () => {
  it('serializes no reference parts or previewOnly ghosts', () => {
    const printed = { polygons: [] }
    const serializer = fakeSerializer()

    serializeSolids(serializer, { binary: true }, [printed, { polygons: [], reference: 'bearing' }, { polygons: [], previewOnly: true }])

    expect(serializer.calls).toEqual([{ options: { binary: true }, solids: [printed] }])
  })

  it('transfers only the binary chunks', () => {
    const result = serializeSolids(fakeSerializer(), {}, [{ polygons: [] }])

    expect(result.data).toHaveLength(2)
    expect(result[Symbol.for('__transferable__')]).toEqual([result.data[1]])
  })
})
