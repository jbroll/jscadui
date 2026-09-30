// The eval backend a live conversation uses: model code runs in executors from
// `start()` (eval/sandbox.js startExecutor). When model code ends one, a fresh
// executor takes over with the project written so far and the model gets an
// EvaluatorCrashed tool error, as the app's user would see the frame fail and
// could go on. Every grade runs in its own fresh executor, so nothing model
// code left behind in the conversation's executor reaches the grade.
import { memoryMessage, OUT_OF_MEMORY, RUN_TOOL_TIMEOUT_MS, runTimeoutError } from '../src/buildReport.js'
import { applyEdit, applyWrite } from '../src/project.js'
import { ExecutorExited, NO_GRADE, toolError } from './executor-protocol.js'
import { GRADE_TIMEOUT_MS } from './grade.js'
import { collectMesh } from './mesh.js'

export const MAX_RESTARTS = 3
export const CALL_TIMEOUT_MS = 110_000
export const READY_TIMEOUT_MS = 60_000
export const MESH_PAGE_TIMEOUT_MS = 30_000

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

const meshFrom = async (executor) => {
  try {
    return await collectMesh((index) => executor.mesh(index, { timeoutMs: MESH_PAGE_TIMEOUT_MS }))
  } catch (error) {
    if (error instanceof ExecutorExited) return { error: `the evaluator ended while sending the mesh (${error.reason})` }
    throw error
  }
}

// A death during the grade grades nothing: the model's code caused it. With
// `mesh`, the same executor then sends the triangles of a model that built.
export const gradeInFreshExecutor = async (start, model, { timeoutMs = GRADE_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS, probe, mesh = false } = {}) => {
  if (!model) return NO_GRADE()
  const executor = start()
  try {
    await whenReady(executor, readyTimeoutMs)
    const graded = await executor.gradeProject(model, probe ? { timeoutMs, probe } : { timeoutMs })
    if (!mesh || !graded.measure) return graded
    return { ...graded, mesh: await meshFrom(executor) }
  } catch (error) {
    if (error instanceof ExecutorExited) return NO_GRADE()
    throw error
  } finally {
    executor.close()
  }
}

// The heap log a V8 out-of-memory exit prints tells the model nothing.
const exitReason = (reason) => (memoryMessage(reason) === reason ? reason : OUT_OF_MEMORY)

export const createSandboxedBackend = ({
  start,
  maxRestarts = MAX_RESTARTS,
  callTimeoutMs = CALL_TIMEOUT_MS,
  readyTimeoutMs = READY_TIMEOUT_MS,
  runToolTimeoutMs = RUN_TOOL_TIMEOUT_MS,
}) => {
  let executor = null
  let project = {}
  let crashes = 0
  let ended = false

  // A restart only reseeds: building the project again could end it again.
  const launch = async (options = {}) => {
    const next = start()
    await whenReady(next, readyTimeoutMs)
    try {
      return { next, report: await next.reset({ ...project }, options) }
    } catch (error) {
      next.close()
      throw new InfrastructureError(`the evaluator did not start: ${error.message}`)
    }
  }

  // With `build`, the seeded project's build report, for the conversation's first message.
  const reset = async (files = {}, options = {}) => {
    project = { ...files }
    executor?.close()
    executor = null
    const { next, report } = await launch(options)
    executor = next
    return report
  }

  // The executor applies the same write or edit, or refuses it the same way.
  const track = (name, input) => {
    try {
      if (name === 'write') project = applyWrite(project, input).files
      else if (name === 'edit') project = applyEdit(project, input).files
    } catch {
      // refused
    }
  }

  const requestTool = async (name, input) => {
    track(name, input)
    if (!executor) return toolError('EvaluatorCrashed', `model code ended the evaluator ${crashes} times; it is not restarted again`)
    const timeoutMs = name === 'run' ? Math.min(runToolTimeoutMs, callTimeoutMs) : callTimeoutMs
    try {
      return await executor.requestTool(name, input, { timeoutMs })
    } catch (error) {
      if (!(error instanceof ExecutorExited)) throw error
      if (ended) return toolError('EvaluatorCrashed', 'the run ended')
      crashes += 1
      executor = null
      const reason = exitReason(error.reason)
      if (crashes > maxRestarts) {
        return toolError('EvaluatorCrashed', `model code ended the evaluator (${reason}); it has now ended it ${crashes} times and is not restarted again`)
      }
      // A scratch run never touched the project, so its build comes back, as the app's frame reloads it.
      const runTimedOut = name === 'run' && error.reason === `ran past ${timeoutMs / 1000} s`
      const { next } = await launch(runTimedOut ? { build: true } : {})
      if (ended) {
        next.close()
        return toolError('EvaluatorCrashed', 'the run ended')
      }
      executor = next
      if (runTimedOut) return JSON.stringify(runTimeoutError(timeoutMs))
      return toolError('EvaluatorCrashed', `model code ended the evaluator (${reason}); a new one holds the project as last written, with nothing built yet`)
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
