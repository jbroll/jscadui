import { availablePlugins, transform } from '@babel/standalone'

import { preventInfiniteLoops } from './src/preventInfiniteLoops'

availablePlugins['preventInfiniteLoops'] = preventInfiniteLoops

export const transformDefaults = {
  retainLines: true,
  // plugins: ['syntax-object-rest-spread', 'preventInfiniteLoops'],
  plugins: ['syntax-object-rest-spread'],
  presets: ["typescript"],
}

function combineAppend(options = {}, append = {}) {
  for (let p in append) {
    if (Object.hasOwn(append, p)) {
      if (options[p]) {
        if (append[p] instanceof Array) options[p] = [...options[p], ...append[p]]
        else options[p] = { ...options[p], ...append[p] }
      } else {
        options[p] = append[p]
      }
    }
  }
  return options
}

function _transform(code, filename, options = {}, append = {}) {
  const op = {
    ...transformDefaults,
    ...options,
    filename
  }
  combineAppend(op, append)
  try {
    return transform(code, op)
  } catch (error) {
    // Add context to transform errors for better debugging
    const message = error.message || String(error)
    const wrappedError = new Error(`Babel transform failed for ${filename}: ${message}`)
    wrappedError.stack = error.stack
    wrappedError.name = error.name || 'SyntaxError'
    throw wrappedError
  }
}

export const transformcjs = (code, filename, options = {}, append = {}) => {
  options = { sourceMaps: 'inline', ...options }
  // Append CommonJS transform plugin
  append = combineAppend({ ...append }, { plugins: ['transform-modules-commonjs'] })
  return _transform(code, filename, options, append)
}

export default transformcjs