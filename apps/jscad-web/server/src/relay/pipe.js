// Plain JS, node: imports only: the production relay and the launcher relay both load it.

/**
 * Write a chunk and wait out backpressure. Resolves false when the response
 * closes first, since a closed response never emits 'drain'.
 * @param {import('node:stream').Writable} res
 * @param {Uint8Array} chunk
 * @returns {Promise<boolean>}
 */
export const writeOrClose = (res, chunk) => {
  if (res.write(chunk)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (/** @type {boolean} */ ok) => {
      res.off('drain', onDrain)
      res.off('close', onClose)
      resolve(ok)
    }
    const onDrain = () => done(true)
    const onClose = () => done(false)
    res.once('drain', onDrain)
    res.once('close', onClose)
  })
}
