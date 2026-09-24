/**
 * A claim asks the frame whether this worker runs a grid leaf. The answer is
 * a __CLAIM__ notification with the id inside params: a message with a
 * top-level id is a request, which the worker would answer.
 * @param {{post: (message: object) => void, randomId?: () => string}} options
 */
export const createClaims = ({ post, randomId = () => crypto.randomUUID() }) => {
  /** @type {Map<unknown, (won: boolean) => void>} */
  const waiting = new Map()
  return {
    /**
     * @param {string} key
     * @param {string} url
     * @param {unknown} runId
     * @returns {Promise<boolean>}
     */
    claim: (key, url, runId) => new Promise((resolve) => {
      const id = randomId()
      waiting.set(id, resolve)
      post({ method: 'jscadClaim', id, params: [{ key, url, runId }] })
    }),
    /** @param {{id?: unknown, won?: unknown}} [answer] */
    answer: ({ id, won } = {}) => {
      const resolve = waiting.get(id)
      if (!resolve) return
      waiting.delete(id)
      resolve(won === true)
    },
  }
}
