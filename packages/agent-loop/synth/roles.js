export const GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

export const FREE_MODELS = ['longcat-2.5-preview-free', 'minimax-m3.1-flash-free', 'beam-free']

// minimax and longcat reason before they answer, and 1500 and 600 tokens ran out mid-reasoning.
export const SIM_USER_MAX_TOKENS = {
  'longcat-2.5-preview-free': 4000,
  'minimax-m3.1-flash-free': 4000,
  'beam-free': 1500,
}

// Each builder's simulated users in order of preference; the first available one runs.
export const ROLES = [
  { builder: 'longcat-2.5-preview-free', vision: true, simUsers: ['minimax-m3.1-flash-free', 'beam-free'] },
  { builder: 'minimax-m3.1-flash-free', vision: true, simUsers: ['longcat-2.5-preview-free', 'beam-free'] },
  { builder: 'beam-free', vision: false, simUsers: ['minimax-m3.1-flash-free', 'longcat-2.5-preview-free'] },
]

export const pickSimUser = (role, probe) => role.simUsers.find((model) => probe[model]?.available) ?? null

export function assertFree(models, probe) {
  for (const model of models) {
    if (!FREE_MODELS.includes(model) || !probe[model]?.available) {
      throw new Error(`refusing to start: ${model} is not a confirmed free model`)
    }
  }
}
