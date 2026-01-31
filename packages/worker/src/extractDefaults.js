/**
 * @param {import("@jscadui/format-common").ParameterDefinition[]} def
 * @returns {import("@jscadui/format-common").UserParameters}
 */
export function extractDefaults(def) {
/** @type {import("@jscadui/format-common").UserParameters} */
  const params = {}
  def.forEach(({ name, initial, default: def, type, values, captions }) =>{
    let val = def === undefined ? initial : def
    // M12 fix: Validate values array exists before using it
    if(type === 'choice' && Array.isArray(values) && values.length > 0){
      if(values.indexOf(val) === -1){
        // it is supported for choice to use default value from captions also
        // but script will need the matching value
        if (captions) {
          for (let i = 0; i < captions.length; i++) {
            if (captions[i] === val) {
              val = values[i]
              break;
            }
          }
        }
        // M12 fix: Always fall back to values[0] if value not found
        if(values.indexOf(val) === -1) val = values[0]
      }
    }
    params[name] = val
  })
  return params
}