/**
 * Stop later code in this worker from receiving its messages. Request ids are
 * what keep model code from answering a request itself, so it must not see
 * them: once the worker's own listener is attached, a new 'message' listener
 * on the scope is ignored and `onmessage` no longer takes a handler. The
 * replaced properties are non-configurable, so model code cannot restore them.
 * @param {object} scope the worker global
 */
export const sealMessageListeners = (scope) => {
  for (let proto = scope; proto; proto = Object.getPrototypeOf(proto)) {
    const add = Object.getOwnPropertyDescriptor(proto, 'addEventListener')
    if (typeof add?.value === 'function') {
      const original = add.value
      Object.defineProperty(proto, 'addEventListener', {
        value: function (type, ...rest) {
          if (this === scope && type === 'message') return
          return original.call(this, type, ...rest)
        },
        writable: false,
        configurable: false,
      })
    }
    if (Object.getOwnPropertyDescriptor(proto, 'onmessage')) {
      Object.defineProperty(proto, 'onmessage', { get: () => null, set: () => {}, configurable: false })
    }
  }
}
