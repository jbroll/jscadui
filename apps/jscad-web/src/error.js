const errorBar = document.getElementById('error-bar')
const errorName = document.getElementById('error-name')
const errorMessage = document.getElementById('error-message')

/**
 * @param {unknown} error
 */
export const setError = error => {
  if (error) {
    // Type-safe access to error properties
    const isErrorLike = error && typeof error === 'object'
    const name = (isErrorLike && 'name' in error ? error.name : 'Error') + ': '
    errorName.innerText = name
    const message = formatStacktrace(error)
    errorMessage.innerText = message
    errorBar.classList.add('visible')
  } else {
    errorBar.classList.remove('visible')
  }
}

/**
 * Extracts the stacktrace for an error thrown from inside an eval function.
 * Returns the stacktrace as a string for just the code running inside eval.
 *
 * @param {unknown} error
 * @returns {string} - stacktrace for code inside eval
 */
const formatStacktrace = (error) => {
  // Handle non-object errors
  if (!error || typeof error !== 'object') {
    return String(error)
  }

  // error.stack is not standard but works on chrome and firefox
  const stack = 'stack' in error ? error.stack : undefined
  const message = 'message' in error ? error.message : String(error)
  if (!stack) return message || String(error)

  // chrome stacktrace (script error, syntax error):
  //  ReferenceError: gggggg is not defined
  //  at causeErr (./jscad.model.js:51:3)
  //  at main (./jscad.model.js:46:27)
  //  at ve (http://localhost:5120/build/bundle.worker.js:28:2964)
  //  at Pt (http://localhost:5120/build/bundle.worker.js:28:3731)
  //  at async http://localhost:5120/build/bundle.worker.js:14:3218
  const cleaned = stack
    .split('\n')
    .filter(line => !line.includes('bundle.worker.js'))

  if (message && !stack.includes(message)) cleaned.unshift(message)
  return cleaned.join('\n')
}