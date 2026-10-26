import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { writeOrClose } from '../src/relay/pipe.js'

const fakeRes = (writeResult) => Object.assign(new EventEmitter(), { write: () => writeResult })

describe('writeOrClose', () => {
  it('resolves true at once when the write is accepted', async () => {
    expect(await writeOrClose(fakeRes(true), new Uint8Array(1))).toBe(true)
  })

  it('resolves true once the response drains', async () => {
    const res = fakeRes(false)
    const pending = writeOrClose(res, new Uint8Array(1))
    res.emit('drain')
    expect(await pending).toBe(true)
  })

  it('resolves false when the response closes while waiting for drain', async () => {
    const res = fakeRes(false)
    const pending = writeOrClose(res, new Uint8Array(1))
    res.emit('close')
    expect(await pending).toBe(false)
  })

  it('leaves no listeners behind', async () => {
    const res = fakeRes(false)
    const pending = writeOrClose(res, new Uint8Array(1))
    res.emit('drain')
    await pending
    expect(res.listenerCount('drain') + res.listenerCount('close')).toBe(0)
  })
})
