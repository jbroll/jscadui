// The modeling API the chat teaches. Both stay importable at run time; the
// setting picks which one the prompt, the examples and docs describe.
export const APIS = ['fluent', 'modeling']
export const DEFAULT_API = 'fluent'

export const checkApi = (api) => {
  if (!APIS.includes(api)) throw new Error(`unknown api ${api}; expected one of ${APIS.join(', ')}`)
  return api
}
