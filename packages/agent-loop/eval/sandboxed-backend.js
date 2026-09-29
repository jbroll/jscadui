// The eval backend a live conversation uses: model code runs in executors from
// `start()` (eval/sandbox.js startExecutor). When model code ends one, a fresh
// executor takes over with the project written so far and the model gets an
// EvaluatorCrashed tool error, as the app's user would see the frame fail and
// could go on. Every grade runs in its own fresh executor, so nothing model
// code left behind in the conversation's executor reaches the grade.
import { ExecutorExited, NO_GRADE, toolError } from './executor-protocol.js'
import { GRADE_TIMEOUT_MS, PROJECT_ENTRY } from './grade.js'

export const MAX_RESTARTS = 3
export const CALL_TIMEOUT_MS = 110_000
const READY_TIMEOUT_MS = 60_000

// The sandbox failed, not the model: the run is left out of the means like a provider error.
export class InfrastructureError extends Error {
  infrastructure = true
}

const whenReady = async (executor, readyTimeoutMs) => {
  let timer
  try {
    await Promise.race([
      executor.ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`not ready within ${readyTimeoutMs / 1000} s`)), readyTimeoutMs)
      }),
    ])
  } catch (error) {
    executor.close()
    throw new InfrastructureError(`the evaluator did not start: ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

// A death during the grade grades nothing: the model's code caused it.
export const gradeInFreshExecutor = async (start, model, { timeoutMs = GRADE_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS } = {}) => {
  if (!model) return NO_GRADE()
  const executor = start()
  try {
    await whenReady(executor, readyTimeoutMs)
    return await executor.gradeProject(model, { timeoutMs })
  } catch (error) {
    if (error instanceof ExecutorExited) return NO_GRADE()
    throw error
  } finally {
    executor.close()
  }
}

export const createSandboxedBackend = ({ start, maxRestarts = MAX_RESTARTS, callTimeoutMs = CALL_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS }) => {
  let executor = null
  let project = {}
  let crashes = 0
  let ended = false

  const launch = async () => {
    const next = start()
    await whenReady(next, readyTimeoutMs)
    try {
      await next.reset({ ...project })
    } catch (error) {
      next.close()
      throw new InfrastructureError(`the evaluator did not start: ${error.message}`)
    }
    return next
  }

  const reset = async (files = {}) => {
    project = { ...files }
    executor?.close()
    executor = null
    executor = await launch()
  }

  const requestTool = async (name, input) => {
    if (name === 'writeModel' && typeof input?.source === 'string') project[input.entry ?? PROJECT_ENTRY] = input.source
    if (!executor) return toolError('EvaluatorCrashed', `model code ended the evaluator ${crashes} times; it is not restarted again`)
    try {
      return await executor.requestTool(name, input, { timeoutMs: callTimeoutMs })
    } catch (error) {
      if (!(error instanceof ExecutorExited)) throw error
      if (ended) return toolError('EvaluatorCrashed', 'the run ended')
      crashes += 1
      executor = null
      if (crashes > maxRestarts) {
        return toolError('EvaluatorCrashed', `model code ended the evaluator (${error.reason}); it has now ended it ${crashes} times and is not restarted again`)
      }
      executor = await launch()
      return toolError('EvaluatorCrashed', `model code ended the evaluator (${error.reason}); a new one holds the project as last written, with nothing evaluated yet`)
    }
  }

  const close = () => {
    ended = true
    executor?.close()
    executor = null
  }

  const gradeProject = async (model, options) => {
    ended = true
    executor?.close()
    executor = null
    return gradeInFreshExecutor(start, model, { readyTimeoutMs, ...options })
  }

  return {
    reset,
    requestTool,
    gradeProject,
    crashes: () => crashes,
    exhausted: () => crashes > maxRestarts,
    close,
  }
}
