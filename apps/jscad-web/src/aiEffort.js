// Effort level metadata shared by the account dialog.
export const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
export const OPENAI_STYLE_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh']
const MUSE_RE = /muse/i

export const effortOptionsForModel = ({ kind, modelId = '', capabilities = null } = {}) => {
  if (!modelId) return []
  let levels
  if (capabilities?.effort && typeof capabilities.effort === 'object') {
    levels = EFFORT_LEVELS.filter((l) => capabilities.effort[l]?.supported)
  } else if (kind === 'anthropic') {
    levels = []
  } else {
    levels = [...OPENAI_STYLE_EFFORTS]
  }
  if (MUSE_RE.test(modelId)) levels = levels.filter((l) => l !== 'none')
  return levels
}

// The level a model gets until the user picks one. An own-key kind skips the
// first option: that is `none` for openai-style lists, which beam-free refuses.
// The free kind keeps the first option.
export const defaultEffort = (options, kind) =>
  kind !== 'jscad-web' && options.includes('medium') ? 'medium' : (options[0] ?? '')
