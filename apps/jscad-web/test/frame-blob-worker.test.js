import { describe, it, expect, vi } from 'vitest'
import { createBlobWorker } from '../src_frame/blobWorker.js'

const setup = () => {
  const created = []
  const revoked = []
  const createObjectURL = vi.fn(() => {
    const url = `blob:worker-${created.length}`
    created.push(url)
    return url
  })
  const revokeObjectURL = vi.fn((url) => revoked.push(url))
  const terminated = []
  class FakeWorker {
    constructor(url) {
      this.url = url
    }
    terminate() {
      terminated.push(this.url)
    }
  }
  const create = (source) =>
    createBlobWorker({ source, createObjectURL, revokeObjectURL, WorkerClass: FakeWorker })
  return { created, revoked, terminated, createObjectURL, create, revokedList: revoked, terminatedList: terminated }
}

describe('createBlobWorker', () => {
  it('revokes its blob URL when the worker is terminated', () => {
    const { create, revokedList, terminatedList } = setup()
    const worker = create('self.onmessage = null')
    worker.terminate()
    expect(terminatedList).toEqual(['blob:worker-0'])
    expect(revokedList).toEqual(['blob:worker-0'])
  })

  it('revokes only its own URL', () => {
    const { create, revokedList } = setup()
    const first = create('a')
    const second = create('b')
    second.terminate()
    expect(revokedList).toEqual(['blob:worker-1'])
    first.terminate()
    expect(revokedList).toEqual(['blob:worker-1', 'blob:worker-0'])
  })
})
