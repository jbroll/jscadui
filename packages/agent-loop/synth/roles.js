export const GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

export const FREE_MODELS = ['longcat-2.5-preview-free', 'minimax-m3.1-flash-free', 'beam-free']

export const ROLES = [
  { builder: 'longcat-2.5-preview-free', vision: true, simUser: 'minimax-m3.1-flash-free', simUserMaxTokens: 1500 },
  { builder: 'minimax-m3.1-flash-free', vision: true, simUser: 'longcat-2.5-preview-free', simUserMaxTokens: 600 },
  { builder: 'beam-free', vision: false, simUser: 'minimax-m3.1-flash-free', simUserMaxTokens: 1500 },
]

export function assertFree(models, probe) {
  for (const model of models) {
    if (!FREE_MODELS.includes(model) || !probe[model]?.available) {
      throw new Error(`refusing to start: ${model} is not a confirmed free model`)
    }
  }
}
