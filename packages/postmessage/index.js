let seq = 1
const reqMap = new Map()
const RESPONSE = '__RESPONSE__'
const TRANSFERABLE = Symbol.for('__transferable__')

// H11 fix: Default timeout prevents memory leak from unbounded reqMap growth
// 5 minutes is generous but prevents infinite hanging requests
const DEFAULT_TIMEOUT = 5 * 60 * 1000

/**
 * Mark objects for transfer via postMessage (zero-copy for TypedArrays).
 *
 * L5 doc: IMPORTANT - After calling postMessage with transferable objects,
 * those objects become "neutered" (detached) and can no longer be accessed
 * by the sender. Callers should not retain references to transferred buffers
 * or attempt to use them after sending.
 *
 * @template T
 * @param {T & {}} params
 * @param {unknown} trans - Array of transferable objects (ArrayBuffer, TypedArray, etc.)
 * @returns T
 */
export const withTransferable = (params, trans) => {
  params[TRANSFERABLE] = trans
  return params
}

const fixTransfer = trans => (trans ? trans.map(a => a.buffer || a) : [])

/**
 *
 * @param {globalThis | Worker} _self reference to self of the main window (self) or reference to a worker
 * @param {*} handlers - object where key if method name, and value ih handler
 * @returns
 */
export const initMessaging = (_self, handlers, { onJobCount, debug } = {}) => {
  // on service worker, postMessage is on the controller
  const ___self = _self.postMessage ? _self : _self.controller

  /**
   * @param {unknown} result 
   * @param {number} id 
   */
  const sendResponse = (result, id) => {
    if (debug) console.log(debug, 'sendResponse', id, result)
    const trans = result?.[TRANSFERABLE]
    if (trans) {
      delete result[TRANSFERABLE]
    }
    try {
      ___self.postMessage({ method: RESPONSE, params: result, id }, fixTransfer(trans))
    } catch (error) {
      console.error((debug || '') + 'failed to send ', result, trans)
      throw error
    }
  }

  const sendError = (error, id) => {
    try {
      // serialize stacktrace so it isn't lost in transit
      const stack = error.stack
      if (debug) console.log(debug, 'sendError', id, error)
      ___self.postMessage({ method: RESPONSE, error: { message: error.message, name: error.name, stack }, id })
    } catch (error) {
      console.error((debug || '') + 'failed to send ', error)
      throw error
    }
  }

  /**
   * Send a message with no response
   *
   * @param {string} method
   * @param {unknown[]} params //TODO
   * @param {Array} trans
   */
  const sendNotify = (method, params = [], trans = []) => {
    if (debug) console.log(debug, 'sendNotify', method, params)
    ___self.postMessage({ method, params }, fixTransfer(trans))
  }

  /**
   * Send a message with response expected
   *
   * @param {string} method
   * @param {object} params
   * @param {Array} transferable
   * @param {number?} timeout
   * @returns {Promise} resolves when response is received
   */
  const sendCmd = (method, params = [], transferable = [], timeout) => {
    const id = seq++
    if (debug) console.log(debug, 'sendCmd', id, method, params)
    ___self.postMessage({ method, params, id }, fixTransfer(transferable))

    const out = new Promise((resolve, reject) => {
      // H11 fix: Always use a timeout (default or provided) to prevent memory leak
      // from requests that never receive responses
      const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT
      // H2 fix: Store timeout ID so it can be cleared when response arrives
      const timeoutId = setTimeout(() => {
        if (reqMap.has(id)) {
          reqMap.delete(id)
          onJobCount?.(reqMap.size)
          reject(new Error(`RPC timeout for ${method} after ${effectiveTimeout}ms`))
        }
      }, effectiveTimeout)
      // Store resolve, reject, and timeoutId for cleanup
      reqMap.set(id, [resolve, reject, timeoutId])
      onJobCount?.(reqMap.size)
    })
    return out
  }

  const listener = async e => {
    const { method, params, id, error } = e.data
    if (debug) console.log(debug, 'received', id, method, params, ...(error ? ['error:', error] : []))
    if (id && method === RESPONSE) {
      const p = reqMap.get(id)

      if (!p) return console.error(`req ${id} not found`, id, e.data, e)
      reqMap.delete(id)
      onJobCount?.(reqMap.size)

      const [resolve, reject, timeoutId] = p
      // H2 fix: Clear timeout when response arrives to prevent memory leak
      if (timeoutId) clearTimeout(timeoutId)
      if (error) {
        // restore stacktrace
        // if(typeof error === 'string')
        const _error = new Error(error.message)
        _error.stack = error.stack
        _error.name = error.name
        reject(_error)
      } else {
        resolve(params)
      }

      return
    }

    if (!Object.hasOwn(handlers, method)) {
      const msg = 'no handler for type: ' + method
      console.error(msg, e)
      throw new Error(msg)
    }
    const fn = handlers[method]
    try {
      const out = await fn(...params)
      if (id) {
        sendResponse(out, id)
      }
    } catch (error) {
      console.error(`error executing command ${method}`, params, error)
      sendError(error, id)
    }
  }

  // H1 fix: Wrap async listener to catch unhandled rejections
  const wrappedListener = (e) => {
    listener(e).catch(err => {
      console.error('Unhandled error in message listener:', err)
    })
  }
  _self.addEventListener?.('message', wrappedListener)

  /**
   * Clean up the message listener. Call when messaging is no longer needed.
   */
  const destroy = () => {
    _self.removeEventListener?.('message', wrappedListener)
  }

  return {
    sendCmd,
    sendNotify,
    sendResponse,
    sendError,
    listener,
    destroy,
    self: _self,
    getRpcJobCount: () => reqMap.size,
  }
}

/**
 *
 * @param {*} _self
 * @param {*} handlers
 * @returns {object}
 */
export const messageProxy = (_self, handlers, { onJobCount, debug } = {}) => {
  const { sendCmd, sendNotify, getRpcJobCount, listener, destroy } = initMessaging(_self, handlers, { onJobCount, debug })
  // creating error is not too expensive in our context as there will not be millions
  // methods produced, and info on how the proxy is created an when called is indispensible for debug
  const created = new Error('proxy')

  return new Proxy(
    { getRpcJobCount, onmessage: listener, destroy },
    {
      get(target, prop, _receiver) {
        // then is used to recognize if object is a promise, we do not want
        // to create a them method for postMessage, it would break async functions
        // that return the proxy
        if (prop in target || prop === 'then') return target[prop]
        if (prop.startsWith('on') && (prop.length == 2 || prop[2] == prop[2].toUpperCase())) {
          return (target[prop] = function (...params) {
            sendNotify(prop, params)
          })
        }
        // same as above Error for debugging
        const methodCreated = new Error('methodCreated')
        return (target[prop] = function (...params) {
          try {
            return sendCmd(prop, params)
          } catch (e) {
            console.error(
              'faild to call ' + prop,
              params,
              '\n',
              e,
              '\ncreated',
              created,
              '\nmethodCreated',
              methodCreated,
            )
          }
        })
      },
    },
  )
}
