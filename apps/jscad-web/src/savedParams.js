export const PARAMS_FILE = 'params.json'

/** The project's saved param values: `{ values }`, `{ error }` for a file that does not parse, or null. */
export const readSaved = (files) => {
  const text = files[PARAMS_FILE]
  if (typeof text !== 'string') return null
  let values
  try {
    values = JSON.parse(text)
  } catch (err) {
    return { error: `${PARAMS_FILE} is not valid JSON: ${err.message}` }
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { error: `${PARAMS_FILE} must hold an object of param values` }
  return { values }
}

export const applicableSaved = (values, defaults) =>
  Object.fromEntries(Object.entries(values).filter(([path]) => path in defaults))

export const serializeSaved = (values) => JSON.stringify(values, null, 2)
