// The model a relay POST body asks for when it is not the session's builder,
// or null when it is. Any other model could be a paid one.
export function offBuilderModel(postData, builder) {
  let model
  try {
    model = JSON.parse(postData ?? '')?.model
  } catch {
    model = undefined
  }
  if (model === builder) return null
  return typeof model === 'string' && model ? model : 'no model'
}
