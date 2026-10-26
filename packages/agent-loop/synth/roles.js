export const GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

// opencode-go's free list as of 2026-10-26; longcat and minimax answered 410, deprecated.
export const FREE_MODELS = ['iceman-contributor-free', 'beam-free']

// A cut-off reply is asked again with twice the cap (simUser.js), so these are starting points.
export const SIM_USER_MAX_TOKENS = {
  'iceman-contributor-free': 4000,
  'beam-free': 1500,
}

// Each builder's simulated users in order of preference; the first available one runs.
export const ROLES = [
  { builder: 'iceman-contributor-free', vision: true, simUsers: ['beam-free'] },
  { builder: 'beam-free', vision: false, simUsers: ['iceman-contributor-free'] },
]

export const pickSimUser = (role, probe) => role.simUsers.find((model) => probe[model]?.available) ?? null

export function assertFree(models, probe) {
  for (const model of models) {
    if (!FREE_MODELS.includes(model) || !probe[model]?.available) {
      throw new Error(`refusing to start: ${model} is not a confirmed free model`)
    }
  }
}
