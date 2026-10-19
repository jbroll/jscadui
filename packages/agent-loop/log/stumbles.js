const isBuild = (step) => step.name === 'write' || step.name === 'edit'

const isUnbuilt = (turn) => turn.steps.findLast(isBuild)?.ok !== true

export const countStumbles = (conversation) => ({
  failedCalls: conversation.turns.flatMap((t) => t.steps).filter((s) => s.ok === false).length,
  unbuiltTurns: conversation.turns.filter(isUnbuilt).length,
})
